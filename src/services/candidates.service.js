const { db } = require('../config/firebase');
const TtlCache = require('../utils/ttlCache');
const { maskContacts, tokenize } = require('../utils/text');
const { validationError } = require('../utils/AppError');
const { JOBS, AVAILABILITIES } = require('../config/referentials');
const { matchesFilters, effectivePlan, keywordsOf } = require('./personnelRanking');

/**
 * Profils candidats (placement du personnel, M10–M12), collection `candidates`.
 *
 * Un profil par utilisateur : id du document = id de l'utilisateur (lecture directe, 1 lecture).
 * Champs affichés du candidat recopiés dans `publisher` (règle de coût n° 4 : pas de N+1).
 * JAMAIS stockés ici : téléphone, e-mail, adresse, âge, situation familiale, religion, ethnie, santé, documents.
 *
 * Document :
 *   userId, status (active | hidden | suspended), title, summary, job (libellé), jobCode, city, district?,
 *   experienceYears, availability, salaryMin?, salaryMax?, skills[], training?, license?,
 *   references { total, verified }, trained (badge sur preuve validée, jamais déclaratif),
 *   media[] (≤ 1 photo), plan (gratuit | standard | premium), planExpiresAt?,
 *   publisher { id, name, avatar, kind: 'candidate', verified, city? }, keywords, createdAt, updatedAt, publishedAt
 */
const COLLECTION = 'candidates';
const col = () => db.collection(COLLECTION);

// Résultats de recherche : 60 s par combinaison de filtres (pagination et compteur sans relecture)
const searchCache = new TtlCache({ ttlMs: 60 * 1000, max: 300 });
// Fiches : 60 s par profil
const docCache = new TtlCache({ ttlMs: 60 * 1000, max: 2000 });

/** À appeler après toute écriture sur `candidates/{id}`. */
const invalidateCandidate = (id) => {
  if (id) docCache.delete(id);
  searchCache.clear();
};

// ─── LECTURE ─────────────────────────────────────────────────────────────────

/** Document `{ id, ...data }` ou null. */
const getCandidate = async (id) => {
  if (!id || typeof id !== 'string' || id.includes('/')) return null;
  const hit = docCache.get(id);
  if (hit !== undefined) return hit;
  const doc = await col().doc(id).get();
  return docCache.set(id, doc.exists ? { id: doc.id, ...doc.data() } : null);
};

/** Plusieurs profils en une requête (`db.getAll`) — ordre conservé, inexistants → null. */
const getCandidates = async (ids) => {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id && !id.includes('/')))];
  if (!unique.length) return new Map();
  const snaps = await db.getAll(...unique.map((id) => col().doc(id)));
  return new Map(snaps.map((s) => [s.id, s.exists ? { id: s.id, ...s.data() } : null]));
};

const isMissingIndex = (err) => err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(err.message || ''));
let warnedMissingIndex = false;

/**
 * Profils actifs correspondant aux filtres (non triés).
 * Les filtres d'égalité sont appliqués par Firestore (seuls les documents correspondants sont lus et facturés) ;
 * texte libre, expérience, salaire et « sous 15 jours » sont filtrés ensuite en mémoire.
 * Requête d'égalités uniquement : servie par la fusion des index simples (aucun index composite requis).
 */
const findActiveCandidates = async (f) => {
  const key = JSON.stringify([f.q, f.job, f.city, f.district, f.verifiedOnly, f.trainedOnly, f.availability, f.experienceMin, f.salaryMax]);
  const hit = searchCache.get(key);
  if (hit) return hit;

  let q = col().where('status', '==', 'active');
  if (f.job) q = q.where('jobCode', '==', f.job);
  if (f.city) q = q.where('city', '==', f.city);
  if (f.district) q = q.where('district', '==', f.district);
  if (f.trainedOnly) q = q.where('trained', '==', true);
  if (f.verifiedOnly) q = q.where('publisher.verified', '==', true);
  if (f.availability === 'immediate' || f.availability === 'a_convenir') q = q.where('availability', '==', f.availability);

  let snap;
  try {
    snap = await q.get();
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    if (!warnedMissingIndex) {
      warnedMissingIndex = true;
      console.warn('[candidates] Requête refusée faute d\'index — filtrage en mémoire en attendant :', err.message);
    }
    snap = await col().where('status', '==', 'active').get();
  }

  const tokens = tokenize(f.q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => matchesFilters(c, f, tokens));
  return searchCache.set(key, list);
};

// ─── FORMES DU CONTRAT ───────────────────────────────────────────────────────

/** Document → `CandidateFeedItem`. */
const toCandidateFeedItem = (c, { isFavorite = false, now = Date.now() } = {}) => {
  const p = c.publisher || {};
  return {
    id: c.id,
    universe: 'personnel',
    publisher: {
      id: p.id || c.userId,
      name: p.name || '',
      avatar: p.avatar || null,
      kind: 'candidate',
      verified: Boolean(p.verified),
      ...(p.rating != null && { rating: p.rating }),
      ...(p.reviewsCount != null && { reviewsCount: p.reviewsCount }),
      ...(p.city && { city: p.city }),
    },
    title: c.title || '',
    city: c.city || '',
    ...(c.district && { district: c.district }),
    media: Array.isArray(c.media) ? c.media.map(({ url, type, alt }) => ({ url, type: type || 'image', ...(alt && { alt }) })) : [],
    createdAt: c.publishedAt || c.createdAt,
    isFavorite,
    sponsored: false, // aucune mise en avant commerciale des profils candidats aujourd'hui
    job: c.job || '',
    jobCode: c.jobCode || '',
    experienceYears: c.experienceYears || 0,
    availability: c.availability || 'a_convenir',
    plan: effectivePlan(c, now),
    trained: Boolean(c.trained),
    ...(c.salaryMin != null && { salaryMin: c.salaryMin }),
    ...(c.salaryMax != null && { salaryMax: c.salaryMax }),
  };
};

/** Document → `CandidateDetail` (profil public M11). */
const toCandidateDetail = (c, { viewerAccess, viewerIsOwner }) => {
  const item = toCandidateFeedItem(c);
  return {
    ...item,
    summary: c.summary || '',
    skills: Array.isArray(c.skills) ? c.skills : [],
    ...(c.training && { training: c.training }),
    ...(c.license && { license: c.license }),
    references: {
      total: (c.references && c.references.total) || 0,
      verified: (c.references && c.references.verified) || 0,
    },
    badges: { identityVerified: item.publisher.verified, trained: item.trained },
    viewerAccess,
    viewerIsOwner,
  };
};

// ─── PUBLICATION ─────────────────────────────────────────────────────────────

const LIMITS = { title: [10, 90], summary: [30, 1500] };

const isAmount = (v) => Number.isInteger(v) && v >= 0 && v <= 100000000;
const isHttpsUrl = (v) => {
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
};

/**
 * Valide le bloc `candidate` d'un brouillon (miroir de frontend-ludra/src/views/publish/schemas.ts).
 * @returns {{ field: string, message: string }[]}
 */
const validateCandidateInput = (input = {}, media = []) => {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  if (!JOBS.some((j) => j.value === input.job)) add('job', 'Choisissez votre métier.');

  const title = text(input.title);
  if (title.length < LIMITS.title[0] || title.length > LIMITS.title[1]) add('title', `Titre du profil : ${LIMITS.title[0]} à ${LIMITS.title[1]} caractères.`);
  const summary = text(input.summary);
  if (summary.length < LIMITS.summary[0] || summary.length > LIMITS.summary[1]) add('summary', `Présentation : ${LIMITS.summary[0]} à ${LIMITS.summary[1]} caractères.`);

  if (!text(input.city) || text(input.city).length > 60) add('city', 'Indiquez la ville.');
  if (input.district !== undefined && input.district !== null && (typeof input.district !== 'string' || input.district.length > 60)) add('district', 'Quartier invalide.');

  if (!Number.isInteger(input.experienceYears) || input.experienceYears < 0 || input.experienceYears > 60) {
    add('experienceYears', "Indiquez vos années d'expérience (0 à 60).");
  }
  if (!AVAILABILITIES.includes(input.availability)) add('availability', 'Indiquez votre disponibilité.');

  if (input.salaryMin != null && !isAmount(input.salaryMin)) add('salaryMin', 'Montant invalide.');
  if (input.salaryMax != null && !isAmount(input.salaryMax)) add('salaryMax', 'Montant invalide.');
  if (isAmount(input.salaryMin) && isAmount(input.salaryMax) && input.salaryMin > input.salaryMax) {
    add('salaryMax', 'Le maximum doit être supérieur au minimum.');
  }

  if (input.skills !== undefined && input.skills !== null) {
    if (!Array.isArray(input.skills) || input.skills.some((s) => typeof s !== 'string' || s.length > 30)) add('skills', '30 caractères maximum par compétence.');
    else if (input.skills.length > 10) add('skills', '10 compétences maximum.');
  }
  if (input.training != null && (typeof input.training !== 'string' || input.training.trim().length > 300)) add('training', '300 caractères maximum.');

  if (!Array.isArray(media) || media.length > 1) add('media', '1 photo maximum.');
  else if (media.some((m) => !m || !isHttpsUrl(m.url) || (m.type && m.type !== 'image'))) add('media', 'Photo invalide.');

  return errors;
};

/**
 * Publie (ou met à jour) le profil candidat de `user`.
 * À appeler par `POST /drafts/:id/publish` (module 06) pour un brouillon `type: 'personnel'`.
 *
 * - textes : téléphones, e-mails et liens masqués ;
 * - plan candidat actif (abonnement déjà payé) repris pour le classement ;
 * - formation nouvelle ou modifiée ⇒ badge « Formé » retiré et preuve `training` envoyée en vérification (M16).
 *
 * @param {object} user        req.user
 * @param {object} input       bloc `candidate` du brouillon
 * @param {{ url: string, type?: string }[]} media
 * @param {{ plan?: string, planExpiresAt?: string }} [activePlan]  plan candidat actif (subscriptions.service)
 * @returns {Promise<{ status: 'published' | 'pending_review', universe: 'personnel', itemId: string }>}
 */
const publishCandidateProfile = async (user, input, media = [], activePlan = {}) => {
  const errors = validateCandidateInput(input, media);
  if (errors.length) throw validationError(errors);

  const now = new Date().toISOString();
  const job = JOBS.find((j) => j.value === input.job);
  const training = input.training ? maskContacts(input.training.trim()) : null;
  const ref = col().doc(user.id);

  const profile = {
    userId: user.id,
    status: 'active',
    title: maskContacts(input.title.trim()),
    summary: maskContacts(input.summary.trim()),
    job: job.label,
    jobCode: job.value,
    city: input.city.trim(),
    district: input.district ? input.district.trim() : null,
    experienceYears: input.experienceYears,
    availability: input.availability,
    salaryMin: input.salaryMin ?? null,
    salaryMax: input.salaryMax ?? null,
    skills: (input.skills || []).map((s) => maskContacts(s.trim())).filter(Boolean),
    training,
    media: media.map((m) => ({ url: m.url, type: 'image' })),
    publisher: {
      id: user.id,
      name: user.name || '',
      avatar: user.avatar || null,
      kind: 'candidate',
      // Badge « Identité vérifiée » : uniquement sur KYC validé (jamais déclaratif)
      verified: user.kycStatus === 'verifie',
      ...(user.city && { city: user.city }),
    },
    plan: activePlan.plan || 'gratuit',
    planExpiresAt: activePlan.planExpiresAt || null,
    updatedAt: now,
    publishedAt: now,
  };
  profile.keywords = keywordsOf(profile);

  let proofNeeded = false;
  let suspended = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : null;
    const trainingUnchanged = prev && prev.training === training;
    proofNeeded = Boolean(training) && !trainingUnchanged;
    suspended = Boolean(prev && prev.status === 'suspended');
    tx.set(ref, {
      ...profile,
      createdAt: (prev && prev.createdAt) || now,
      // Le badge « Formé » ne survit que si la formation validée n'a pas changé
      trained: Boolean(trainingUnchanged && prev.trained),
      references: (prev && prev.references) || { total: 0, verified: 0 },
      license: (prev && prev.license) || null,
      // Un profil suspendu par la modération le reste
      ...(prev && prev.status === 'suspended' && { status: 'suspended' }),
    });
    if (proofNeeded) {
      tx.set(db.collection('proofs').doc(`training_${user.id}`), {
        kind: 'training',
        userId: user.id,
        userName: user.name || user.email || '',
        itemId: user.id,
        itemTitle: profile.title,
        label: training,
        submittedAt: now,
        status: 'a_verifier',
      });
    }
  });
  invalidateCandidate(user.id);

  // Profil suspendu par la modération : mis à jour mais pas remis en ligne
  return { status: suspended ? 'pending_review' : 'published', universe: 'personnel', itemId: user.id };
};

module.exports = {
  COLLECTION,
  getCandidate,
  getCandidates,
  findActiveCandidates,
  toCandidateFeedItem,
  toCandidateDetail,
  validateCandidateInput,
  publishCandidateProfile,
  invalidateCandidate,
};
