const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/role');
const ctrl = require('../controllers/admin.controller');

// Back-office V2.1 : toutes les routes exigent un compte admin|proprietaire (+ permission par route).
// Les autres endpoints /admin/* du contrat (queue, kyc, listings, reviews, reports, payments,
// settings, audit) sont à ajouter ici — docs/API_CONTRACT_V2.1.md, étape 11.
router.use(authenticate, requireRole('admin', 'proprietaire'));

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Indicateurs du tableau de bord (AdminStats)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: AdminStats
 */
router.get('/stats', ctrl.getStats);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Liste des utilisateurs (CursorPage<AdminUser>) — permission manage_users
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [user, landlord, admin] }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "{ items: AdminUser[], nextCursor, total }"
 */
router.get('/users', requirePermission('manage_users'), ctrl.getUsers);

/**
 * @swagger
 * /admin/users/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Modifier rôle, permissions ou statut (manage_users ; rôle/permissions → add_admin). Journalisé.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role: { type: string, enum: [user, landlord, admin] }
 *               adminPermissions: { type: array, items: { type: string } }
 *               isActive: { type: boolean }
 *               reason: { type: string, description: "Obligatoire (≥ 5 car.) pour une suspension" }
 *     responses:
 *       200:
 *         description: AdminUser
 *       403:
 *         description: Permission insuffisante ou compte principal
 *       422:
 *         description: Données invalides / motif manquant
 */
router.patch('/users/:id', requirePermission('manage_users'), ctrl.updateUser);

/**
 * @swagger
 * /admin/proofs:
 *   get:
 *     tags: [Admin]
 *     summary: Preuves du badge « Formé » (AdminProof[]) — permission review_kyc
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [a_verifier, valide, rejete], default: a_verifier }
 *     responses:
 *       200:
 *         description: AdminProof[]
 */
router.get('/proofs', requirePermission('review_kyc'), ctrl.getProofs);

/**
 * @swagger
 * /admin/proofs/{id}/decision:
 *   post:
 *     tags: [Admin]
 *     summary: Valider / refuser une preuve (approve active le badge Formé). Journalisé.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [approve, reject] }
 *               reason: { type: string, description: "Obligatoire (≥ 5 car.) pour un refus" }
 *     responses:
 *       200:
 *         description: Décision enregistrée
 *       409:
 *         description: ALREADY_DECIDED
 *       422:
 *         description: VALIDATION_ERROR (motif manquant)
 */
router.post('/proofs/:id/decision', requirePermission('review_kyc'), ctrl.decideProof);

/**
 * @swagger
 * /admin/payments:
 *   get:
 *     tags: [Admin]
 *     summary: Paiements (AdminPayment[], 200 plus récents) — permission view_payments
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, paid, failed, expired, cancelled] } }
 *       - { in: query, name: purpose, schema: { type: string, enum: [unlock_contact, subscription] } }
 *     responses:
 *       200:
 *         description: AdminPayment[]
 *       422:
 *         description: VALIDATION_ERROR (filtre inconnu)
 */
router.get('/payments', requirePermission('view_payments'), ctrl.getPayments);

/**
 * @swagger
 * /admin/payments/{id}/reconcile:
 *   post:
 *     tags: [Admin]
 *     summary: Vérifier auprès de l'opérateur un paiement pending sans webhook (AdminPayment). Journalisé.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: AdminPayment à jour (le statut peut rester pending)
 *       404:
 *         description: Paiement introuvable
 *       409:
 *         description: NOT_PENDING ou NOT_RECONCILABLE
 *       502:
 *         description: PROVIDER_UNREACHABLE
 */
router.post('/payments/:id/reconcile', requirePermission('manage_payments'), ctrl.reconcilePayment);

module.exports = router;
