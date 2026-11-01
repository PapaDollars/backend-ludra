const crypto = require('crypto');
const { db } = require('../config/firebase');
const { AppError, notFound, validationError } = require('../utils/AppError');
const { createNotification } = require('../utils/notifications');
const { findPlan } = require('./settings.service');
const { prepareActivation, invalidateSubscriptions } = require('./subscriptions.service');
const { invalidateCandidate } = require('./candidates.service');
const { getProvider, SIMULATION_DELAY_MS } = require('./mobileMoney');

/**
 * Paiements Mobile Money (`Payment`, contrat V2.1 étapes 3, 6 et 8), collection `payments`.
 *
 * - Idempotence : id du document = hash(utilisateur + Idempotency-Key) et `create()` ⇒ un nouvel essai avec la
 *   même clé renvoie le même paiement, sans nouvelle demande à l'opérateur (aucun double débit).
 * - `pending` → `paid | failed | expired` uniquement via `settlePayment` (webhook fournisseur, ou simulation).
 * - Un paiement `pending` sans réponse après 15 min passe `expired` (calculé à la lecture).
 */
const COLLECTION = 'payments';
const OPERATORS = ['mtn_momo', 'orange_money'];
const PENDING_TTL_MS = 15 * 60 * 1000;
const ALREADY_EXISTS = 6; // code gRPC Firestore

const col = () => db.collection(COLLECTION);

/** Document → `Payment` (le numéro payeur et les données fournisseur ne sortent jamais). */
const toPayment = (id, d) => ({
  id,
  purpose: d.purpose,
  status: d.status,
  amount: d.amount,
  currency: 'XAF',
  operator: d.operator,
  ...(d.listingId && { listingId: d.listingId }),
  ...(d.planCode && { planCode: d.planCode }),
  createdAt: d.createdAt,
  ...(d.paidAt && { paidAt: d.paidAt }),
  ...(d.failureReason && { failureReason: d.failureReason }),
});

const paymentId = (userId, idempotencyKey) =>
  `pay_${crypto.createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex').slice(0, 24)}`;

/** Valide `{ operator, payerPhone, idempotencyKey }` (format normalisé par le front : 6XXXXXXXX). */
const validateMobileMoneyInput = ({ operator, payerPhone, idempotencyKey }) => {
  const errors = [];
  if (!OPERATORS.includes(operator)) errors.push({ field: 'operator', message: 'Choisissez MTN MoMo ou Orange Money.' });
  if (typeof payerPhone !== 'string' || !/^6\d{8}$/.test(payerPhone)) errors.push({ field: 'payerPhone', message: 'Numéro Mobile Money invalide (6XXXXXXXX).' });
  if (typeof idempotencyKey !== 'string' || !/^[\w-]{8,100}$/.test(idempotencyKey)) errors.push({ field: 'idempotencyKey', message: "Clé d'idempotence invalide." });
  if (errors.length) throw validationError(errors);
};

// ─── RÈGLEMENT (webhook / simulation) ────────────────────────────────────────

/**
 * Applique le résultat opérateur à un paiement `pending` (idempotent : sans effet sinon).
 * `paid` d'un abonnement ⇒ activation dans la même transaction (pas de paiement payé sans droit, ni l'inverse).
 *
 * @param {string} id
 * @param {{ status: 'paid' | 'failed' | 'expired' | 'cancelled', failureReason?: string, operatorReference?: string }} result
 * @returns {Promise<object|null>} document à jour, ou null si introuvable
 */
const settlePayment = async (id, { status, failureReason, operatorReference }) => {
  const ref = col().doc(id);
  const pre = await ref.get();
  if (!pre.exists) return null;
  // Plan lu hors transaction (cache) : la transaction ne contient que des lectures Firestore
  const plan = pre.data().purpose === 'subscription' ? await findPlan(pre.data().planCode) : null;

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const p = snap.data();
    if (p.status !== 'pending') return { changed: false, payment: p };

    const write = status === 'paid' && p.purpose === 'subscription' && plan
      ? await prepareActivation(tx, { id, userId: p.userId }, plan)
      : null;

    const now = new Date().toISOString();
    const updates = {
      status,
      updatedAt: now,
      ...(status === 'paid' && { paidAt: now }),
      ...(status !== 'paid' && { failureReason: failureReason || 'Le paiement n’a pas abouti. Aucun montant n’a été débité.' }),
      ...(operatorReference && { operatorReference }),
    };
    tx.update(ref, updates);
    const activation = write ? write() : null;
    return { changed: true, payment: { ...p, ...updates }, activation };
  });

  const p = outcome.payment;
  if (outcome.changed) {
    if (p.purpose === 'subscription') {
      invalidateSubscriptions(p.userId);
      if (outcome.activation && outcome.activation.candidateUpdated) invalidateCandidate(p.userId);
    }
    const label = p.label || 'Paiement';
    const notification = status === 'paid'
      ? { kind: 'subscription', title: `${label} activé`, body: 'Votre paiement a été confirmé par l’opérateur.', href: '/compte/paiements' }
      : { kind: 'payment', title: 'Paiement non abouti', body: `${label} : ${p.failureReason}`, href: '/compte/paiements' };
    await createNotification(p.userId, notification).catch((err) => console.error('[paiements] Notification non envoyée :', err.message));
  }
  return p;
};

/** Règlements différés (simulation, paiement expiré) : appliqués à la lecture si l'échéance est passée. */
const settleIfDue = async (id, d) => {
  if (d.status !== 'pending') return d;
  const now = Date.now();
  if (d.simulation && Date.parse(d.simulation.resolveAt) <= now) {
    return (await settlePayment(id, { status: d.simulation.outcome, failureReason: d.simulation.failureReason })) || d;
  }
  if (Date.parse(d.createdAt) + PENDING_TTL_MS <= now) {
    return (await settlePayment(id, { status: 'expired', failureReason: 'Délai de confirmation dépassé. Aucun montant n’a été débité.' })) || d;
  }
  return d;
};

// ─── CRÉATION ────────────────────────────────────────────────────────────────

/**
 * Crée (ou retrouve, même clé d'idempotence) un paiement et déclenche la demande Mobile Money.
 * @param {object} user  req.user
 * @param {{ purpose: string, amount: number, label: string, planCode?: string, listingId?: string,
 *           operator: string, payerPhone: string, idempotencyKey: string }} input
 */
const createPayment = async (user, input) => {
  validateMobileMoneyInput(input);
  const provider = getProvider(); // 503 avant toute écriture si aucun fournisseur n'est utilisable

  const id = paymentId(user.id, input.idempotencyKey);
  const ref = col().doc(id);
  const now = new Date().toISOString();
  const data = {
    userId: user.id,
    purpose: input.purpose,
    status: 'pending',
    amount: input.amount,
    currency: 'XAF',
    operator: input.operator,
    payerPhone: input.payerPhone,
    label: input.label,
    ...(input.planCode && { planCode: input.planCode }),
    ...(input.listingId && { listingId: input.listingId }),
    provider: provider.name,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await ref.create(data);
  } catch (err) {
    if (err.code !== ALREADY_EXISTS) throw err;
    // Même clé : même paiement, aucune nouvelle demande à l'opérateur
    const existing = (await ref.get()).data();
    if (existing.purpose !== input.purpose || existing.planCode !== input.planCode || existing.listingId !== input.listingId) {
      throw new AppError("Clé d'idempotence déjà utilisée pour un autre paiement.", 409, 'IDEMPOTENCY_CONFLICT');
    }
    return toPayment(id, await settleIfDue(id, existing));
  }

  let result;
  try {
    result = await provider.request({ id, ...data }, { payerPhone: input.payerPhone });
  } catch (err) {
    console.error(`[paiements] Demande ${provider.name} échouée pour ${id} :`, err.message);
    const failed = await settlePayment(id, { status: 'failed', failureReason: 'L’opérateur n’a pas pu traiter la demande. Aucun montant n’a été débité.' });
    return toPayment(id, failed);
  }

  const updates = {
    ...(result.operatorReference && { operatorReference: result.operatorReference }),
    ...(result.simulation && { simulation: result.simulation }),
  };
  if (Object.keys(updates).length) await ref.update(updates);

  if (result.simulation) {
    // Simule le webhook opérateur ; si le serveur redémarre entre-temps, GET /payments/:id règle le paiement.
    setTimeout(() => {
      settlePayment(id, { status: result.simulation.outcome, failureReason: result.simulation.failureReason })
        .catch((err) => console.error('[paiements] Simulation :', err.message));
    }, SIMULATION_DELAY_MS + 100).unref();
  }

  return toPayment(id, { ...data, ...updates });
};

/** `POST /payments/subscription` : paiement d'un plan payant (M08 / M12 / M13). */
const createSubscriptionPayment = async (user, { planCode, ...mm }) => {
  const plan = typeof planCode === 'string' ? await findPlan(planCode) : null;
  if (!plan || !plan.active) throw notFound('Plan introuvable');
  if (!plan.price) throw new AppError('Le plan gratuit ne nécessite pas de paiement.', 422, 'FREE_PLAN');

  const audienceLabel = { owner_agent: 'Propriétaire / Agent', candidate: 'Candidat', recruiter: 'Recruteur' }[plan.audience];
  return createPayment(user, {
    ...mm,
    purpose: 'subscription',
    amount: plan.price,
    planCode: plan.code,
    label: `${plan.period === 'month' ? 'Abonnement' : 'Plan'} ${plan.name} — ${audienceLabel}`,
  });
};

/** `GET /payments/:id` : réservé au propriétaire du paiement (404 sinon, sans révéler l'existence). */
const getPaymentForUser = async (user, id) => {
  if (typeof id !== 'string' || !/^pay_[a-f0-9]{24}$/.test(id)) throw notFound('Paiement introuvable');
  const snap = await col().doc(id).get();
  if (!snap.exists || snap.data().userId !== user.id) throw notFound('Paiement introuvable');
  return toPayment(id, await settleIfDue(id, snap.data()));
};

module.exports = { createSubscriptionPayment, getPaymentForUser, settlePayment, toPayment, OPERATORS };
