const { db } = require('../config/firebase');
const { AppError, notFound } = require('../utils/AppError');
const { recruiterRightsFor } = require('./settings.service');
const { getActiveSubscription } = require('./subscriptions.service');
const { getCandidate, getCandidates, toCandidateFeedItem } = require('./candidates.service');

/**
 * Accès recruteur (M13) et shortlist.
 * Droits = forfait recruteur actif (subscriptions.service) ; sans forfait : aucun droit.
 * Shortlist : un document par recruteur `shortlists/{userId}` = `{ entries: [{ candidateId, addedAt }] }`.
 */
const SHORTLIST_MAX = 200;
const shortlistRef = (userId) => db.collection('shortlists').doc(userId);

/** Forfait + droits du recruteur, sans compteur de shortlist. */
const getRecruiterPlan = async (userId) => {
  const sub = await getActiveSubscription(userId, 'recruiter');
  return {
    planCode: sub ? sub.planCode : null,
    planName: sub ? sub.planName : null,
    expiresAt: sub ? sub.expiresAt : null,
    rights: await recruiterRightsFor(sub && sub.planCode),
  };
};

const readEntries = async (userId) => {
  const snap = await shortlistRef(userId).get();
  return snap.exists && Array.isArray(snap.data().entries) ? snap.data().entries : [];
};

/** `RecruiterAccess` (`GET /recruiter/access`). */
const getRecruiterAccess = async (userId) => {
  const plan = await getRecruiterPlan(userId);
  const shortlistCount = plan.rights.shortlist ? (await readEntries(userId)).length : 0;
  return { ...plan, shortlistCount };
};

/** Refuse (`403 PLAN_REQUIRED`) si le forfait actif n'ouvre pas `right`. */
const requireRight = async (userId, right) => {
  const plan = await getRecruiterPlan(userId);
  if (!plan.rights[right]) {
    throw new AppError('Fonction réservée aux forfaits recruteurs.', 403, 'PLAN_REQUIRED');
  }
  return plan;
};

/**
 * Le recruteur peut-il ouvrir une conversation avec ce candidat ? (contrat étape 8)
 * À appeler par `POST /conversations/open` (module 05) quand `itemId` est un profil candidat :
 * refuser avec `403 PLAN_REQUIRED` si faux, sauf si le candidat a lui-même initié l'échange.
 */
const canContactCandidates = async (userId) => (await getRecruiterPlan(userId)).rights.contact;

/** Entrées → `ShortlistEntry[]` (profils retirés ou masqués exclus), plus récentes d'abord. */
const toShortlist = async (entries) => {
  const docs = await getCandidates(entries.map((e) => e.candidateId));
  return entries
    .filter((e) => docs.get(e.candidateId) && docs.get(e.candidateId).status === 'active')
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
    .map((e) => ({ candidate: toCandidateFeedItem(docs.get(e.candidateId)), addedAt: e.addedAt }));
};

/** Profils shortlistés (bruts, avec `addedAt`) — pour la shortlist et l'export. */
const getShortlistEntries = async (userId) => readEntries(userId);

const getShortlist = async (userId) => {
  await requireRight(userId, 'shortlist');
  return toShortlist(await readEntries(userId));
};

/** Ajout idempotent. */
const addToShortlist = async (userId, candidateId) => {
  await requireRight(userId, 'shortlist');
  const c = await getCandidate(candidateId);
  if (!c || c.status !== 'active') throw notFound('Profil introuvable');
  if (c.userId === userId) throw new AppError('Vous ne pouvez pas ajouter votre propre profil.', 400);

  const entries = await db.runTransaction(async (tx) => {
    const snap = await tx.get(shortlistRef(userId));
    const list = snap.exists && Array.isArray(snap.data().entries) ? snap.data().entries : [];
    if (list.some((e) => e.candidateId === candidateId)) return list;
    if (list.length >= SHORTLIST_MAX) {
      throw new AppError(`Shortlist pleine (${SHORTLIST_MAX} profils maximum).`, 409, 'SHORTLIST_FULL');
    }
    const next = [{ candidateId, addedAt: new Date().toISOString() }, ...list];
    tx.set(shortlistRef(userId), { entries: next, updatedAt: new Date().toISOString() });
    return next;
  });
  return toShortlist(entries);
};

const removeFromShortlist = async (userId, candidateId) => {
  await requireRight(userId, 'shortlist');
  const entries = await db.runTransaction(async (tx) => {
    const snap = await tx.get(shortlistRef(userId));
    const list = snap.exists && Array.isArray(snap.data().entries) ? snap.data().entries : [];
    const next = list.filter((e) => e.candidateId !== candidateId);
    if (next.length !== list.length) tx.set(shortlistRef(userId), { entries: next, updatedAt: new Date().toISOString() });
    return next;
  });
  return toShortlist(entries);
};

// ─── EXPORT CSV ──────────────────────────────────────────────────────────────

const AVAILABILITY_LABEL = { immediate: 'Immédiate', sous_15_jours: 'Sous 15 jours', a_convenir: 'À convenir' };

// Cellule CSV : guillemets doublés ; préfixe ' devant = + - @ (injection de formules dans Excel)
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * Shortlist au format CSV (UTF-8 avec BOM, séparateur `;`). Droit `exportShortlist`.
 * Colonnes : nom, métier, ville, expérience, disponibilité, formé, lien profil — AUCUNE coordonnée.
 */
const exportShortlistCsv = async (userId) => {
  await requireRight(userId, 'exportShortlist');
  const rows = await toShortlist(await readEntries(userId));
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const lines = [
    ['Nom', 'Métier', 'Ville', 'Expérience (ans)', 'Disponibilité', 'Formé', 'Profil'],
    ...rows.map(({ candidate: c }) => [
      c.publisher.name, c.job, c.city, c.experienceYears, AVAILABILITY_LABEL[c.availability] || c.availability,
      c.trained ? 'oui' : 'non', `${base}/personnel/candidats/${encodeURIComponent(c.id)}`,
    ]),
  ];
  return `﻿${lines.map((r) => r.map(cell).join(';')).join('\r\n')}`;
};

module.exports = {
  getRecruiterPlan,
  getRecruiterAccess,
  requireRight,
  canContactCandidates,
  getShortlistEntries,
  getShortlist,
  addToShortlist,
  removeFromShortlist,
  exportShortlistCsv,
};
