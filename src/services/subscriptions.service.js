const { db } = require('../config/firebase');
const TtlCache = require('../utils/ttlCache');
const { PLAN_AUDIENCES, CANDIDATE_PLAN_LEVEL } = require('../config/plans');
const { COLLECTION: CANDIDATES } = require('./candidates.service');

/**
 * Abonnements (M08, M12, M13), collection `subscriptions`.
 *
 * Un seul abonnement par utilisateur et par audience : id du document = `{userId}_{audience}`.
 * Lecture des abonnements d'un utilisateur = `db.getAll` de 3 documents, sans requête ni index.
 * Le statut est calculé à la lecture : `active` tant que `expiresAt` n'est pas dépassé
 * (les droits recruteur sont donc révoqués à l'expiration sans tâche planifiée).
 */
const COLLECTION = 'subscriptions';
const DAY_MS = 24 * 60 * 60 * 1000;

const subRef = (userId, audience) => db.collection(COLLECTION).doc(`${userId}_${audience}`);

// Abonnements par utilisateur : 60 s (lus à chaque /recruiter/access, /candidates/:id, /search authentifié)
const cache = new TtlCache({ ttlMs: 60 * 1000, max: 5000 });
const invalidateSubscriptions = (userId) => cache.delete(userId);

const statusOf = (d, now) => {
  if (d.status === 'cancelled') return 'cancelled';
  return d.status === 'active' && Date.parse(d.expiresAt) > now ? 'active' : 'expired';
};

/** Document → `Subscription`. */
const toSubscription = (id, d, now = Date.now()) => ({
  id,
  planCode: d.planCode,
  planName: d.planName,
  audience: d.audience,
  status: statusOf(d, now),
  startedAt: d.startedAt,
  expiresAt: d.expiresAt,
});

/** Abonnements ACTIFS de l'utilisateur (`GET /subscriptions/me`). */
const getActiveSubscriptions = async (userId) => {
  let docs = cache.get(userId);
  if (!docs) {
    const snaps = await db.getAll(...PLAN_AUDIENCES.map((a) => subRef(userId, a)));
    docs = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, data: s.data() }));
    cache.set(userId, docs);
  }
  const now = Date.now();
  return docs.map((d) => toSubscription(d.id, d.data, now)).filter((s) => s.status === 'active');
};

/** Abonnement actif d'une audience, ou null. */
const getActiveSubscription = async (userId, audience) =>
  (await getActiveSubscriptions(userId)).find((s) => s.audience === audience) || null;

/** Plan candidat actif → champs `plan` / `planExpiresAt` d'un profil candidat. */
const candidatePlanOf = (sub) => (
  sub && CANDIDATE_PLAN_LEVEL[sub.planCode] ? { plan: CANDIDATE_PLAN_LEVEL[sub.planCode], planExpiresAt: sub.expiresAt } : {}
);

/**
 * Prépare l'activation d'un abonnement payé, DANS une transaction Firestore (lectures d'abord).
 * Renvoie une fonction d'écriture à appeler après les autres lectures de la transaction.
 *
 * - même plan encore actif ⇒ prolongation à partir de l'échéance en cours ;
 * - autre plan de la même audience ⇒ remplacement immédiat (un seul abonnement actif par audience) ;
 * - plan candidat ⇒ niveau de visibilité du profil mis à jour (classement), sans toucher compétences ni badges.
 *
 * @param {FirebaseFirestore.Transaction} tx
 * @param {{ id: string, userId: string }} payment
 * @param {object} plan  plan effectif (settings.service.findPlan)
 */
const prepareActivation = async (tx, payment, plan) => {
  const ref = subRef(payment.userId, plan.audience);
  const candidateRef = plan.audience === 'candidate' ? db.collection(CANDIDATES).doc(payment.userId) : null;
  const [subSnap, candidateSnap] = await Promise.all([tx.get(ref), candidateRef ? tx.get(candidateRef) : null]);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const prev = subSnap.exists ? subSnap.data() : null;
  const extend = prev && prev.planCode === plan.code && statusOf(prev, nowMs) === 'active';
  const startMs = extend ? Date.parse(prev.expiresAt) : nowMs;
  const expiresAt = new Date(startMs + plan.durationDays * DAY_MS).toISOString();

  const subscription = {
    userId: payment.userId,
    audience: plan.audience,
    planCode: plan.code,
    planName: plan.name,
    status: 'active',
    startedAt: extend ? prev.startedAt : now,
    expiresAt,
    lastPaymentId: payment.id,
    ...(prev && !extend && { replacedPlanCode: prev.planCode }),
    updatedAt: now,
  };

  return () => {
    tx.set(ref, subscription);
    if (candidateSnap && candidateSnap.exists && CANDIDATE_PLAN_LEVEL[plan.code]) {
      tx.update(candidateRef, { plan: CANDIDATE_PLAN_LEVEL[plan.code], planExpiresAt: expiresAt, updatedAt: now });
    }
    return { subscription: toSubscription(ref.id, subscription), candidateUpdated: Boolean(candidateSnap && candidateSnap.exists) };
  };
};

module.exports = {
  getActiveSubscriptions,
  getActiveSubscription,
  candidatePlanOf,
  prepareActivation,
  invalidateSubscriptions,
};
