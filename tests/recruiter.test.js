const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeFirebase } = require('./helpers/fakeFirestore');

const db = installFakeFirebase();
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'https://ludra.test';

const recruiter = require('../src/services/recruiter.service');
const { invalidateSubscriptions, getActiveSubscriptions } = require('../src/services/subscriptions.service');
const { invalidateCandidate } = require('../src/services/candidates.service');

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const mkUser = () => { n += 1; const u = { id: `r${n}`, name: `Recruteur ${n}`, isActive: true }; db.seed(`users/${u.id}`, u); return u; };
const mkCandidate = (extra = {}) => {
  n += 1;
  const id = `c${n}`;
  db.seed(`candidates/${id}`, {
    userId: id, status: 'active', title: 'Chauffeuse', job: 'Chauffeur', jobCode: 'driver', city: 'Douala', experienceYears: 4,
    availability: 'immediate', trained: true, plan: 'gratuit', media: [], publishedAt: new Date().toISOString(),
    publisher: { id, name: `Candidat ${n}`, avatar: null, kind: 'candidate', verified: true }, ...extra,
  });
  invalidateCandidate(id);
  return id;
};
/** Abonnement recruteur posé directement (le paiement est testé ailleurs). */
const subscribe = (user, planCode, { expiresInMs = 10 * DAY, status = 'active' } = {}) => {
  db.seed(`subscriptions/${user.id}_recruiter`, {
    userId: user.id, audience: 'recruiter', planCode, planName: planCode, status,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });
  invalidateSubscriptions(user.id);
};
const rejectsPlan = (p) => assert.rejects(p, (e) => e.statusCode === 403 && e.code === 'PLAN_REQUIRED');

test('sans forfait : planCode null, tous les droits à false, aucune fonction ouverte', async () => {
  const u = mkUser();
  const access = await recruiter.getRecruiterAccess(u.id);
  assert.equal(access.planCode, null);
  assert.equal(access.expiresAt, null);
  assert.equal(access.shortlistCount, 0);
  assert.ok(Object.values(access.rights).every((v) => v === false));
  assert.equal(await recruiter.canContactCandidates(u.id), false);
  await rejectsPlan(recruiter.getShortlist(u.id));
  await rejectsPlan(recruiter.addToShortlist(u.id, mkCandidate()));
  await rejectsPlan(recruiter.exportShortlistCsv(u.id));
});

test('droits par forfait : Essentiel (contact, shortlist) < Formé (+ export) < Premium (+ présélection, support)', async () => {
  const [a, b, c] = [mkUser(), mkUser(), mkUser()];
  subscribe(a, 'rec_essentiel');
  subscribe(b, 'rec_forme');
  subscribe(c, 'rec_premium');
  const ra = (await recruiter.getRecruiterAccess(a.id)).rights;
  const rb = (await recruiter.getRecruiterAccess(b.id)).rights;
  const rc = (await recruiter.getRecruiterAccess(c.id)).rights;
  assert.deepEqual([ra.contact, ra.advancedFilters, ra.shortlist, ra.trainedPriority, ra.exportShortlist], [true, true, true, false, false]);
  assert.deepEqual([rb.trainedPriority, rb.exportShortlist, rb.assistedPreselection, rb.prioritySupport], [true, true, false, false]);
  assert.ok(Object.values(rc).every((v) => v === true));
  await rejectsPlan(recruiter.exportShortlistCsv(a.id));
});

test('forfait expiré ou annulé ⇒ droits révoqués immédiatement (sans tâche planifiée)', async () => {
  const expired = mkUser();
  subscribe(expired, 'rec_forme', { expiresInMs: -1000 });
  assert.equal((await recruiter.getRecruiterAccess(expired.id)).planCode, null);
  assert.equal(await recruiter.canContactCandidates(expired.id), false);
  await rejectsPlan(recruiter.getShortlist(expired.id));
  assert.deepEqual(await getActiveSubscriptions(expired.id), []);

  const cancelled = mkUser();
  subscribe(cancelled, 'rec_forme', { status: 'cancelled' });
  assert.equal(await recruiter.canContactCandidates(cancelled.id), false);
});

test('un forfait qui expire en cours de route coupe l’accès à la lecture suivante', async () => {
  const u = mkUser();
  subscribe(u, 'rec_forme');
  assert.equal(await recruiter.canContactCandidates(u.id), true);
  subscribe(u, 'rec_forme', { expiresInMs: -1 }); // l’échéance passe (le cache de 60 s est vidé par subscribe)
  assert.equal(await recruiter.canContactCandidates(u.id), false);
});

test('shortlist : ajout idempotent, retrait, profil propre / masqué / inconnu refusés', async () => {
  const u = mkUser();
  subscribe(u, 'rec_forme');
  const c1 = mkCandidate();
  const c2 = mkCandidate();
  await recruiter.addToShortlist(u.id, c1);
  const afterTwice = await recruiter.addToShortlist(u.id, c1);
  assert.equal(afterTwice.length, 1);
  const two = await recruiter.addToShortlist(u.id, c2);
  assert.deepEqual(two.map((e) => e.candidate.id), [c2, c1], 'plus récent d’abord');
  assert.equal((await recruiter.getRecruiterAccess(u.id)).shortlistCount, 2);

  assert.deepEqual((await recruiter.removeFromShortlist(u.id, c1)).map((e) => e.candidate.id), [c2]);
  assert.deepEqual((await recruiter.removeFromShortlist(u.id, 'absent')).map((e) => e.candidate.id), [c2], 'retrait d’un absent : sans effet');

  await assert.rejects(recruiter.addToShortlist(u.id, 'inconnu'), (e) => e.statusCode === 404);
  const hidden = mkCandidate({ status: 'hidden' });
  await assert.rejects(recruiter.addToShortlist(u.id, hidden), (e) => e.statusCode === 404);
  db.seed(`candidates/${u.id}`, { ...db.peek(`candidates/${c1}`), userId: u.id, publisher: { id: u.id, name: 'Moi', kind: 'candidate', verified: false } });
  invalidateCandidate(u.id);
  await assert.rejects(recruiter.addToShortlist(u.id, u.id), (e) => e.statusCode === 400);
});

test('shortlist : un profil masqué après coup disparaît de la liste', async () => {
  const u = mkUser();
  subscribe(u, 'rec_essentiel');
  const c = mkCandidate();
  await recruiter.addToShortlist(u.id, c);
  db.seed(`candidates/${c}`, { ...db.peek(`candidates/${c}`), status: 'suspended' });
  invalidateCandidate(c);
  assert.deepEqual(await recruiter.getShortlist(u.id), []);
});

test('shortlists séparées : un recruteur ne voit jamais celle d’un autre', async () => {
  const [a, b] = [mkUser(), mkUser()];
  subscribe(a, 'rec_forme');
  subscribe(b, 'rec_forme');
  await recruiter.addToShortlist(a.id, mkCandidate());
  assert.equal((await recruiter.getShortlist(a.id)).length, 1);
  assert.equal((await recruiter.getShortlist(b.id)).length, 0);
});

test('export CSV : BOM, séparateur ;, aucune coordonnée, formules neutralisées', async () => {
  const u = mkUser();
  subscribe(u, 'rec_forme');
  const evil = mkCandidate({ publisher: { id: 'x', name: '=HYPERLINK("http://evil","clic")', kind: 'candidate', verified: false }, phone: '677112233', email: 'a@b.cm' });
  const ok = mkCandidate();
  await recruiter.addToShortlist(u.id, evil);
  await recruiter.addToShortlist(u.id, ok);
  const csv = await recruiter.exportShortlistCsv(u.id);

  assert.ok(csv.startsWith('﻿'), 'BOM UTF-8');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], '"Nom";"Métier";"Ville";"Expérience (ans)";"Disponibilité";"Formé";"Profil"');
  assert.equal(lines.length, 3);
  assert.ok(!/677112233|a@b\.cm/.test(csv), 'aucune coordonnée');
  const evilLine = lines.find((l) => l.includes('HYPERLINK'));
  assert.ok(evilLine.startsWith('"\'=HYPERLINK'), `formule non neutralisée : ${evilLine}`);
  assert.ok(evilLine.includes('""http://evil""'), 'guillemets doublés');
  assert.ok(csv.includes(`https://ludra.test/personnel/candidats/${ok}`));
  assert.ok(csv.includes('"Immédiate"') && csv.includes('"oui"'));
});
