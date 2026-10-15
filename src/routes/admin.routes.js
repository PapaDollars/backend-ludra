const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/role');
const ctrl = require('../controllers/admin.controller');

// Back-office V2.1 : toutes les routes exigent un compte admin|proprietaire (+ permission par route).
// Les autres endpoints /admin/* du contrat (queue, kyc, listings, reviews, reports, payments, proofs,
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

module.exports = router;
