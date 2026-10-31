const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/billing.controller');

/**
 * Plans, abonnements et paiements — trois routeurs montés dans routes/index.js :
 * `/plans`, `/subscriptions`, `/payments`.
 */

// ─── /plans ──────────────────────────────────────────────────────────────────
const plans = express.Router();

/**
 * @swagger
 * /plans:
 *   get:
 *     tags: [Abonnements]
 *     summary: Plans actifs d'une audience (Plan[], triés par rang)
 *     security: []
 *     parameters:
 *       - in: query
 *         name: audience
 *         schema: { type: string, enum: [owner_agent, candidate, recruiter] }
 *     responses:
 *       200:
 *         description: Plan[]
 */
plans.get('/', ctrl.getPlans);

// ─── /subscriptions ──────────────────────────────────────────────────────────
const subscriptions = express.Router();

/**
 * @swagger
 * /subscriptions/me:
 *   get:
 *     tags: [Abonnements]
 *     summary: Mes abonnements actifs (Subscription[])
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription[]
 */
subscriptions.get('/me', authenticate, ctrl.getMySubscriptions);

// ─── /payments ───────────────────────────────────────────────────────────────
const payments = express.Router();
payments.use(authenticate);

// Demandes de paiement : 10 par minute et par adresse IP (le suivi GET /payments/:id n'est pas concerné)
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Trop de demandes de paiement, réessayez dans une minute.' },
});

/**
 * @swagger
 * /payments/subscription:
 *   post:
 *     tags: [Abonnements]
 *     summary: Payer un plan par Mobile Money (Payment, purpose subscription) — activation au statut paid
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [planCode, operator, payerPhone, idempotencyKey]
 *             properties:
 *               planCode: { type: string, example: rec_forme }
 *               operator: { type: string, enum: [mtn_momo, orange_money] }
 *               payerPhone: { type: string, example: '677112233' }
 *               idempotencyKey: { type: string }
 *     responses:
 *       200:
 *         description: Payment (même clé ⇒ même paiement, aucun double débit)
 *       404:
 *         description: Plan introuvable
 *       422:
 *         description: VALIDATION_ERROR ou FREE_PLAN
 *       503:
 *         description: PAYMENT_UNAVAILABLE (aucun fournisseur Mobile Money configuré)
 */
payments.post('/subscription', createLimiter, ctrl.subscribe);

/**
 * @swagger
 * /payments/{id}:
 *   get:
 *     tags: [Abonnements]
 *     summary: Suivi d'un paiement (propriétaire uniquement)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "Payment (status pending | paid | failed | expired | cancelled)"
 *       404:
 *         description: Paiement introuvable
 */
payments.get('/:id', ctrl.getPayment);

module.exports = { plans, subscriptions, payments };
