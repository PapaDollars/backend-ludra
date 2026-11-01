const crypto = require('crypto');
const { db } = require('../config/firebase');
const { AppError, notFound, validationError } = require('../utils/AppError');
const { getUser } = require('../utils/userCache');
const { createAuditEntry } = require('../utils/audit');
const { publishCandidateProfile } = require('./candidates.service');
const { getActiveSubscription, candidatePlanOf } = require('./subscriptions.service');

/**
 * Brouillons de publication « + Publier » (module 06, contrat V2.1 étape 5), collection `drafts`.
 *
 * - Sauvegarde automatique (PATCH toutes les ~1,2 s) : AUCUNE validation métier bloquante ;
 *   les champs inconnus ou mal typés sont simplement ignorés, les textes tronqués à une taille de sécurité.
 * - La validation complète se fait à la publication (`publishDraft`).
 * - Univers publiables aujourd'hui : `personnel`. `immobilier` et `services` : 501 tant que les collections
 *   annonces / prestataires V2.1 n'existent pas (les brouillons, eux, sont bien enregistrés).
 */
const COLLECTION = 'drafts';
const UNIVERSES = ['immobilier', 'personnel', 'services'];
const MAX_DRAFTS_PER_USER = 30;
const MAX_MEDIA = 10;
const PUBLISHABLE = ['personnel'];

const col = () => db.collection(COLLECTION);

// ─── NETTOYAGE DES DONNÉES (sans validation métier) ──────────────────────────
// Tailles de sécurité ≈ 2 × les limites métier : un texte trop long reste visible et sera
// signalé à la publication, au lieu d'être tronqué en silence.
const str = (max) => (v) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const strs = (maxItems, maxLen) => (v) => (Array.isArray(v)
  ? v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => x.slice(0, maxLen))
  : undefined);

const BLOCKS = {
  listing: {
    publisherRole: str(20), agencyName: str(160), transaction: str(20), propertyKind: str(30),
    title: str(200), description: str(6000), city: str(80), district: str(80),
    price: num, priceUnit: str(20), bedrooms: num, bathrooms: num, surface: num,
    amenities: strs(30, 40), availableNow: bool,
  },
  candidate: {
    job: str(60), title: str(200), summary: str(3000), city: str(80), district: str(80),
    experienceYears: num, availability: str(20), salaryMin: num, salaryMax: num,
    skills: strs(20, 60), training: str(600),
  },
  service: {
    category: str(60), structure: str(20), businessName: str(160), title: str(200),
    description: str(4000), city: str(80), priceFrom: num,
  },
};

const cleanBlock = (schema, value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  Object.entries(schema).forEach(([key, clean]) => {
    const v = clean(value[key]);
    if (v !== undefined) out[key] = v;
  });
  return out;
};

const cleanMedia = (value) => (Array.isArray(value) ? value : [])
  .filter((m) => m && typeof m.id === 'string' && /^up_[a-f0-9]{24}$/.test(m.id) && typeof m.url === 'string' && m.url.startsWith('https://'))
  .slice(0, MAX_MEDIA)
  .map((m) => ({ id: m.id, url: m.url.slice(0, 500), type: 'image' }));

/** Champs modifiables par le client (POST / PATCH). `sourceItemId` et `onBehalfOf` sont fixés par le serveur. */
const cleanPatch = (body = {}) => {
  const out = {};
  if ('type' in body) out.type = UNIVERSES.includes(body.type) ? body.type : null;
  if (Number.isInteger(body.step) && body.step >= 0 && body.step <= 4) out.step = body.step;
  if ('listing' in body) out.listing = cleanBlock(BLOCKS.listing, body.listing);
  if ('candidate' in body) out.candidate = cleanBlock(BLOCKS.candidate, body.candidate);
  if ('service' in body) out.service = cleanBlock(BLOCKS.service, body.service);
  if ('media' in body) out.media = cleanMedia(body.media);
  return out;
};

/** Document → `PublishDraft`. */
const toDraft = (id, d) => ({
  id,
  type: d.type || null,
  step: d.step || 0,
  listing: d.listing || {},
  candidate: d.candidate || {},
  service: d.service || {},
  media: d.media || [],
  ...(d.sourceItemId && { sourceItemId: d.sourceItemId }),
  ...(d.onBehalfOf && { onBehalfOf: d.onBehalfOf }),
  updatedAt: d.updatedAt,
});

/** Permission `add_property` : publier pour le compte d'un utilisateur. */
const canActOnBehalf = (user) => user.role === 'proprietaire'
  || (user.role === 'admin' && (user.adminPermissions || []).includes('add_property'));

const validId = (id) => typeof id === 'string' && /^dr_[a-f0-9]{24}$/.test(id);

/** Brouillon de l'utilisateur (404 s'il n'existe pas ou appartient à quelqu'un d'autre). */
const getOwnDraftDoc = async (userId, id) => {
  if (!validId(id)) throw notFound('Brouillon introuvable');
  const snap = await col().doc(id).get();
  if (!snap.exists || snap.data().userId !== userId) throw notFound('Brouillon introuvable');
  return snap;
};

// ─── CRUD ────────────────────────────────────────────────────────────────────

const isMissingIndex = (err) => err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(err.message || ''));
let warnedMissingIndex = false;

/** `GET /drafts` : brouillons typés, plus récents d'abord. */
const listDrafts = async (userId) => {
  const base = col().where('userId', '==', userId);
  let docs;
  try {
    // Index composite userId + updatedAt (firestore.indexes.json)
    docs = (await base.orderBy('updatedAt', 'desc').limit(MAX_DRAFTS_PER_USER).get()).docs;
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    if (!warnedMissingIndex) {
      warnedMissingIndex = true;
      console.warn('[drafts] Index composite manquant — tri en mémoire :', err.message);
    }
    docs = (await base.get()).docs.sort((a, b) => String(b.data().updatedAt).localeCompare(String(a.data().updatedAt)));
  }
  return docs.map((d) => toDraft(d.id, d.data())).filter((d) => d.type);
};

/**
 * `POST /drafts` : crée un brouillon. `onBehalfOf: { userId }` réservé à la permission `add_property`
 * (le nom affiché est relu côté serveur, jamais pris du client).
 */
const createDraft = async (user, body = {}) => {
  const count = (await col().where('userId', '==', user.id).count().get()).data().count;
  if (count >= MAX_DRAFTS_PER_USER) {
    throw new AppError(`Vous avez déjà ${MAX_DRAFTS_PER_USER} brouillons. Publiez-en ou supprimez-en avant d'en créer un autre.`, 409, 'DRAFT_LIMIT');
  }

  let onBehalfOf = null;
  if (body.onBehalfOf) {
    if (!canActOnBehalf(user)) throw new AppError('Permission insuffisante pour publier pour le compte d\'un utilisateur.', 403, 'FORBIDDEN');
    const targetId = body.onBehalfOf.userId;
    const target = typeof targetId === 'string' && !targetId.includes('/') ? await getUser(targetId) : null;
    if (!target || target.isActive === false || target.role === 'proprietaire') throw notFound('Utilisateur introuvable');
    onBehalfOf = { userId: targetId, name: target.name || target.email || targetId };
  }

  const now = new Date().toISOString();
  const data = {
    userId: user.id,
    type: null, step: 0, listing: {}, candidate: {}, service: {}, media: [],
    ...cleanPatch(body),
    ...(onBehalfOf && { onBehalfOf }),
    createdAt: now,
    updatedAt: now,
  };
  const ref = col().doc(`dr_${crypto.randomBytes(12).toString('hex')}`);
  await ref.create(data);
  return toDraft(ref.id, data);
};

const getDraft = async (userId, id) => {
  const snap = await getOwnDraftDoc(userId, id);
  return toDraft(snap.id, snap.data());
};

/** `PATCH /drafts/:id` : remplace les champs envoyés (1 lecture + 1 écriture). */
const updateDraft = async (userId, id, body) => {
  const snap = await getOwnDraftDoc(userId, id);
  const updates = { ...cleanPatch(body), updatedAt: new Date().toISOString() };
  await snap.ref.update(updates);
  return toDraft(snap.id, { ...snap.data(), ...updates });
};

const deleteDraft = async (userId, id) => {
  const snap = await getOwnDraftDoc(userId, id);
  await snap.ref.delete();
};

// ─── PUBLICATION ─────────────────────────────────────────────────────────────

/** Vérifie que chaque média vient d'un upload de l'auteur du brouillon (pas d'URL arbitraire). */
const verifiedMedia = async (draft) => {
  if (!draft.media.length) return [];
  const snaps = await db.getAll(...draft.media.map((m) => db.collection('uploads').doc(m.id)));
  const ok = snaps.every((s) => s.exists && s.data().userId === draft.userId);
  if (!ok) throw validationError([{ field: 'media', message: 'Une photo est introuvable : retirez-la et téléversez-la à nouveau.' }]);
  return snaps.map((s) => ({ url: s.data().url, type: 'image' }));
};

/**
 * `POST /drafts/:id/publish` : validation complète puis publication ; le brouillon est supprimé en cas de succès.
 * @returns {Promise<{ status: 'published' | 'pending_review' | 'pending_kyc', universe: string, itemId: string }>}
 */
const publishDraft = async (user, id) => {
  const snap = await getOwnDraftDoc(user.id, id);
  const draft = { id: snap.id, ...snap.data() };

  if (!draft.type) throw validationError([{ field: 'type', message: 'Choisissez un type de publication.' }]);
  if (!PUBLISHABLE.includes(draft.type)) {
    const what = draft.type === 'immobilier' ? 'des biens immobiliers' : 'des services';
    throw new AppError(`La publication ${what} n'est pas encore disponible. Votre brouillon est conservé.`, 501, 'NOT_IMPLEMENTED');
  }

  // Publication pour le compte d'un utilisateur : permission revérifiée au moment de publier
  let publisher = user;
  if (draft.onBehalfOf) {
    if (!canActOnBehalf(user)) throw new AppError('Permission insuffisante pour publier pour le compte d\'un utilisateur.', 403, 'FORBIDDEN');
    publisher = await getUser(draft.onBehalfOf.userId);
    if (!publisher || publisher.isActive === false) throw notFound('Utilisateur introuvable');
  }

  const media = await verifiedMedia(draft);
  const sub = await getActiveSubscription(publisher.id, 'candidate');
  const result = await publishCandidateProfile(publisher, draft.candidate || {}, media, candidatePlanOf(sub));

  await snap.ref.delete();
  if (draft.onBehalfOf) {
    await createAuditEntry(user, {
      action: 'publication.on_behalf', targetType: 'user', targetId: publisher.id,
      targetLabel: `${publisher.name || publisher.email} — profil candidat`,
    });
  }
  return result;
};

module.exports = {
  listDrafts, createDraft, getDraft, updateDraft, deleteDraft, publishDraft, cleanPatch,
};
