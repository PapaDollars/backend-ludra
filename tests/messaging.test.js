const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeFirebase } = require('./helpers/fakeFirestore');

const db = installFakeFirebase();
process.env.NODE_ENV = 'test';

const msg = require('../src/services/messaging.service');
const { invalidateSubscriptions } = require('../src/services/subscriptions.service');
const { invalidateCandidate } = require('../src/services/candidates.service');

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
const mkUser = (extra = {}) => { n += 1; const u = { id: `m${n}`, name: `Personne ${n}`, isActive: true, ...extra }; db.seed(`users/${u.id}`, u); return u; };
/** Candidat : utilisateur + profil actif (id du profil = id de l'utilisateur). */
const mkCandidate = (extra = {}) => {
  const u = mkUser();
  db.seed(`candidates/${u.id}`, {
    userId: u.id, status: 'active', title: `Profil de ${u.name}`, job: 'Chauffeur', city: 'Douala', media: [{ url: 'https://img.test/a.jpg', type: 'image' }],
    publisher: { id: u.id, name: u.name, avatar: null, kind: 'candidate', verified: false }, ...extra,
  });
  invalidateCandidate(u.id);
  return u;
};
const setPlan = (user, expiresInMs = 10 * DAY) => {
  db.seed(`subscriptions/${user.id}_recruiter`, {
    userId: user.id, audience: 'recruiter', planCode: 'rec_essentiel', planName: 'Essentiel', status: 'active',
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });
  invalidateSubscriptions(user.id);
};
const notificationsOf = (userId) => [...db.store.entries()].filter(([p, d]) => p.startsWith('notifications/') && d.userId === userId).map(([, d]) => d);
const messagesIn = (cid) => [...db.store.keys()].filter((p) => p.startsWith(`conversations/${cid}/messages/`));
const fails = (p, status, code) => assert.rejects(p, (e) => e.statusCode === status && (code === undefined || e.code === code));

test.beforeEach(() => db.reset());

// ─── Droit « contact » (ce qui rend les forfaits utiles) ─────────────────────

test('recruteur sans forfait ⇒ 403 PLAN_REQUIRED vers un candidat, et aucune conversation créée', async () => {
  const recruiter = mkUser();
  const cand = mkCandidate();
  await fails(msg.openConversation(recruiter, { recipientId: cand.id, itemId: cand.id }), 403, 'PLAN_REQUIRED');
  await fails(msg.openConversation(recruiter, { recipientId: cand.id }), 403, 'PLAN_REQUIRED'); // sans itemId : pas de contournement
  assert.equal([...db.store.keys()].filter((p) => p.startsWith('conversations/')).length, 0);
});

test('forfait actif ⇒ conversation ouverte ; idempotent ; invisible dans la liste tant qu’elle est vide', async () => {
  const recruiter = mkUser();
  setPlan(recruiter);
  const cand = mkCandidate();
  const a = await msg.openConversation(recruiter, { recipientId: cand.id, itemId: cand.id });
  const b = await msg.openConversation(recruiter, { recipientId: cand.id, itemId: cand.id });
  assert.equal(a.id, b.id);
  assert.equal([...db.store.keys()].filter((p) => p.startsWith('conversations/')).length, 1);
  assert.equal(a.participant.id, cand.id);
  assert.equal(a.participant.kind, 'candidate');
  assert.equal(a.context.universe, 'personnel');
  assert.equal(a.context.thumbnail, 'https://img.test/a.jpg');
  assert.deepEqual((await msg.listConversations(recruiter)).items, []);
  assert.deepEqual((await msg.listConversations(cand)).items, []);
});

test('le candidat peut écrire le premier à un recruteur SANS forfait, puis le recruteur répond sans forfait', async () => {
  const recruiter = mkUser();
  const cand = mkCandidate();
  const c = await msg.openConversation(cand, { recipientId: recruiter.id, itemId: cand.id });
  await msg.sendMessage(cand, c.id, { text: 'Bonjour, je suis disponible.' });
  // le recruteur (sans forfait) ouvre : retrouve la conversation existante, initiée par le candidat
  const again = await msg.openConversation(recruiter, { recipientId: cand.id, itemId: cand.id });
  assert.equal(again.id, c.id);
  const reply = await msg.sendMessage(recruiter, c.id, { text: 'Merci, parlons-en.' });
  assert.equal(reply.fromMe, true);
  assert.equal(messagesIn(c.id).length, 2);
});

test('forfait recruteur expiré ⇒ il ne peut plus écrire dans la conversation qu’il a ouverte ; le candidat peut répondre', async () => {
  const recruiter = mkUser();
  setPlan(recruiter);
  const cand = mkCandidate();
  const c = await msg.openConversation(recruiter, { recipientId: cand.id, itemId: cand.id });
  await msg.sendMessage(recruiter, c.id, { text: 'Bonjour' });

  setPlan(recruiter, -1000); // le forfait expire
  await fails(msg.sendMessage(recruiter, c.id, { text: 'Encore là ?' }), 403, 'PLAN_REQUIRED');
  assert.equal(messagesIn(c.id).length, 1);
  await msg.sendMessage(cand, c.id, { text: 'Oui, je réponds.' }); // le candidat n’est pas bloqué
  assert.equal(messagesIn(c.id).length, 2);

  setPlan(recruiter); // renouvelle ⇒ il peut de nouveau écrire
  await msg.sendMessage(recruiter, c.id, { text: 'Merci' });
  assert.equal(messagesIn(c.id).length, 3);
});

test('conversation entre deux utilisateurs ordinaires : aucun forfait requis', async () => {
  const [a, b] = [mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  assert.equal(c.context, null);
  await msg.sendMessage(a, c.id, { text: 'Salut' });
});

// ─── Validation et confidentialité ───────────────────────────────────────────

test('ouverture : soi-même 400, destinataire inconnu/désactivé 404, objet étranger 404, ids invalides 422', async () => {
  const [a, b] = [mkUser(), mkUser({ isActive: false })];
  setPlan(a);
  const other = mkCandidate();
  await fails(msg.openConversation(a, { recipientId: a.id }), 400, 'SELF_CONVERSATION');
  await fails(msg.openConversation(a, { recipientId: 'inconnu' }), 404);
  await fails(msg.openConversation(a, { recipientId: b.id }), 404);
  const third = mkUser();
  await fails(msg.openConversation(a, { recipientId: third.id, itemId: other.id }), 404); // profil d’un tiers
  await fails(msg.openConversation(a, { recipientId: third.id, itemId: 'inconnu' }), 404);
  await fails(msg.openConversation(a, { recipientId: '../x' }), 422);
  await fails(msg.openConversation(a, {}), 422);
});

test('un non-participant n’accède à rien (404) : détail, messages, envoi, lecture, blocage', async () => {
  const [a, b, intrus] = [mkUser(), mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  await msg.sendMessage(a, c.id, { text: 'privé' });
  await fails(msg.getConversation(intrus, c.id), 404);
  await fails(msg.listMessages(intrus, c.id), 404);
  await fails(msg.sendMessage(intrus, c.id, { text: 'coucou' }), 404);
  await fails(msg.markRead(intrus, c.id), 404);
  await fails(msg.setBlocked(intrus, c.id, true), 404);
  await fails(msg.getConversation(a, 'cv_inexistant'), 404);
  assert.deepEqual((await msg.listConversations(intrus)).items, []);
});

test('coordonnées et liens masqués côté serveur, dans la réponse ET dans la base', async () => {
  const [a, b] = [mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  const sent = await msg.sendMessage(a, c.id, { text: 'Appelez le 677 11 22 33 ou écrivez à moi@mail.com, voir www.site.cm' });
  assert.ok(!/\d{6}|@|www/.test(sent.text), sent.text);
  assert.deepEqual(sent.moderation.sort(), ['contact_masked', 'link_blocked']);
  const stored = db.peek(messagesIn(c.id)[0]);
  assert.equal(stored.text, sent.text);
  const seenByB = (await msg.listMessages(b, c.id)).items[0];
  assert.equal(seenByB.text, sent.text);
  assert.equal(seenByB.fromMe, false);
  assert.ok(!/677|moi@mail/.test((await msg.listConversations(b)).items[0].lastMessage.text));
});

test('message vide, espaces seuls ou trop long ⇒ 422 ; 2000 caractères acceptés', async () => {
  const [a, b] = [mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  await fails(msg.sendMessage(a, c.id, { text: '' }), 422);
  await fails(msg.sendMessage(a, c.id, { text: '   ' }), 422);
  await fails(msg.sendMessage(a, c.id, {}), 422);
  await fails(msg.sendMessage(a, c.id, { text: 'x'.repeat(2001) }), 422);
  await msg.sendMessage(a, c.id, { text: 'x'.repeat(2000) });
  assert.equal(messagesIn(c.id).length, 1);
});

test('la conversation ne contient ni téléphone ni e-mail des participants', async () => {
  const a = mkUser({ phone: '699000111', email: 'a@secret.cm' });
  const b = mkUser({ phone: '677000222', email: 'b@secret.cm' });
  const c = await msg.openConversation(a, { recipientId: b.id });
  assert.ok(!/699000111|677000222|secret\.cm/.test(JSON.stringify(c)));
  assert.ok(!/699000111|677000222|secret\.cm/.test(JSON.stringify(db.peek(`conversations/${c.id}`))));
});

// ─── Blocage, lecture, notifications ─────────────────────────────────────────

test('blocage : envoi refusé 403 BLOCKED des deux côtés, drapeaux par participant, déblocage rétablit', async () => {
  const [a, b] = [mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  await msg.sendMessage(a, c.id, { text: 'avant' });

  const blocked = await msg.setBlocked(b, c.id, true);
  assert.equal(blocked.blockedByMe, true);
  assert.equal(blocked.blockedMe, false);
  assert.equal((await msg.getConversation(a, c.id)).blockedMe, true);
  await fails(msg.sendMessage(a, c.id, { text: 'après' }), 403, 'BLOCKED');
  await fails(msg.sendMessage(b, c.id, { text: 'moi aussi' }), 403, 'BLOCKED');
  assert.equal(messagesIn(c.id).length, 1);

  const unblocked = await msg.setBlocked(b, c.id, false);
  assert.equal(unblocked.blockedByMe, false);
  await msg.sendMessage(a, c.id, { text: 'de nouveau' });
  assert.equal(messagesIn(c.id).length, 2);
});

test('non lus : compteur par participant, une seule notification tant que non lu, lecture remet à 0 et informe l’autre', async () => {
  const [a, b] = [mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  await msg.sendMessage(a, c.id, { text: 'un' });
  await msg.sendMessage(a, c.id, { text: 'deux' });

  const forB = (await msg.listConversations(b)).items[0];
  assert.equal(forB.unreadCount, 2);
  assert.equal(forB.lastMessage.text, 'deux');
  assert.equal(forB.lastMessage.fromMe, false);
  assert.equal((await msg.listConversations(a)).items[0].unreadCount, 0);
  assert.equal(notificationsOf(b.id).length, 1, 'une notification, pas une par message');
  assert.equal(notificationsOf(b.id)[0].kind, 'message');
  assert.equal(notificationsOf(b.id)[0].href, `/messages/${c.id}`);
  assert.ok(!/un|deux/.test(notificationsOf(b.id)[0].body), 'le contenu du message ne fuit pas dans la notification');

  assert.equal((await msg.getConversation(a, c.id)).participantLastReadAt, null);
  await msg.markRead(b, c.id);
  assert.equal((await msg.getConversation(b, c.id)).unreadCount, 0);
  assert.ok((await msg.getConversation(a, c.id)).participantLastReadAt, 'l’expéditeur voit « Lu »');

  await msg.sendMessage(a, c.id, { text: 'trois' });
  assert.equal(notificationsOf(b.id).length, 2, 'nouvelle notification après lecture');
  assert.equal((await msg.getConversation(b, c.id)).unreadCount, 1);
});

// ─── Listes et pagination ────────────────────────────────────────────────────

test('liste : non vides seulement, plus récentes d’abord, filtre q, repli sans index composite', async () => {
  const me = mkUser({ name: 'Moi' });
  const [x, y, z] = [mkUser({ name: 'Alice Mballa' }), mkUser({ name: 'Bernard Eto' }), mkUser({ name: 'Zoé Vide' })];
  const cx = await msg.openConversation(me, { recipientId: x.id });
  const cy = await msg.openConversation(me, { recipientId: y.id });
  await msg.openConversation(me, { recipientId: z.id }); // jamais utilisée : invisible
  await msg.sendMessage(me, cx.id, { text: 'a' });
  await msg.sendMessage(me, cy.id, { text: 'b' });

  assert.deepEqual((await msg.listConversations(me)).items.map((c) => c.id), [cy.id, cx.id]);
  assert.deepEqual((await msg.listConversations(me, { q: 'mballa' })).items.map((c) => c.id), [cx.id]);
  assert.deepEqual((await msg.listConversations(me, { q: 'zzz' })).items, []);
  db.simulateMissingIndex = true;
  assert.deepEqual((await msg.listConversations(me)).items.map((c) => c.id), [cy.id, cx.id]);
});

test('liste : pagination par curseur sans perte ni doublon, même avec des dates identiques', async () => {
  const me = mkUser();
  const ids = [];
  for (let i = 0; i < 25; i += 1) {
    const other = mkUser();
    const c = await msg.openConversation(me, { recipientId: other.id });
    await msg.sendMessage(me, c.id, { text: `m${i}` });
    ids.push(c.id);
  }
  // Force des horodatages identiques sur plusieurs conversations (cas réel : envois dans la même milliseconde)
  const same = new Date().toISOString();
  ids.slice(0, 8).forEach((id) => db.seed(`conversations/${id}`, { ...db.peek(`conversations/${id}`), updatedAt: same }));

  const p1 = await msg.listConversations(me);
  assert.equal(p1.items.length, 20);
  assert.ok(p1.nextCursor);
  const p2 = await msg.listConversations(me, { cursor: p1.nextCursor });
  assert.equal(p2.items.length, 5);
  assert.equal(p2.nextCursor, null);
  const all = [...p1.items, ...p2.items].map((c) => c.id);
  assert.equal(new Set(all).size, 25, 'aucun doublon, aucune perte');
});

test('messages : ordre chronologique même dans la même milliseconde, before/after, nextCursor, curseur invalide 422', async () => {
  const [a, b] = [mkUser(), mkUser()];
  const c = await msg.openConversation(a, { recipientId: b.id });
  const sent = [];
  for (let i = 1; i <= 5; i += 1) sent.push(await msg.sendMessage(i % 2 ? a : b, c.id, { text: `message ${i}` }));

  const latest = await msg.listMessages(a, c.id, { limit: 2 });
  assert.deepEqual(latest.items.map((m) => m.text), ['message 4', 'message 5']);
  assert.equal(latest.nextCursor, latest.items[0].id);
  const older = await msg.listMessages(a, c.id, { before: latest.nextCursor, limit: 2 });
  assert.deepEqual(older.items.map((m) => m.text), ['message 2', 'message 3']);
  const oldest = await msg.listMessages(a, c.id, { before: older.nextCursor, limit: 2 });
  assert.deepEqual(oldest.items.map((m) => m.text), ['message 1']);
  assert.equal(oldest.nextCursor, null);

  const newer = await msg.listMessages(a, c.id, { after: sent[2].id });
  assert.deepEqual(newer.items.map((m) => m.text), ['message 4', 'message 5']);
  assert.deepEqual((await msg.listMessages(a, c.id, { after: sent[4].id })).items, []);
  assert.deepEqual(newer.items.map((m) => m.fromMe), [false, true], 'fromMe calculé pour le lecteur');
  await fails(msg.listMessages(a, c.id, { before: 'nimporte' }), 422);
  await fails(msg.listMessages(a, c.id, { after: '1; DROP' }), 422);
});
