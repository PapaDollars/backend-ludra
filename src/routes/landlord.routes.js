const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const ctrl = require('../controllers/landlord.controller');

router.use(authenticate, requireRole('landlord', 'admin'));

/**
 * @swagger
 * /landlord/stats:
 *   get:
 *     tags: [Landlord]
 *     summary: Statistiques du tableau de bord propriétaire
 *     description: Retourne total, disponible, occupé, en attente, revenu mensuel, taux d'occupation, par type, par localisation
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques complètes du landlord
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total: { type: integer }
 *                 available: { type: integer }
 *                 occupied: { type: integer }
 *                 pending: { type: integer }
 *                 monthlyRevenue: { type: number }
 *                 averagePrice: { type: number }
 *                 occupancyRate: { type: number }
 *                 typesStats: { type: object }
 *                 locationStats: { type: object }
 */
router.get('/stats', ctrl.getStats);

/**
 * @swagger
 * /landlord/properties:
 *   get:
 *     tags: [Landlord]
 *     summary: Propriétés appartenant au landlord connecté
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, occupied, pending] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Propriétés du landlord
 */
router.get('/properties', ctrl.getMyProperties);

/**
 * @swagger
 * /landlord/contacts:
 *   get:
 *     tags: [Landlord]
 *     summary: Messages reçus pour toutes ses propriétés
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Liste des messages reçus
 */
router.get('/contacts', ctrl.getMyContacts);

/**
 * @swagger
 * /landlord/visits:
 *   get:
 *     tags: [Landlord]
 *     summary: Demandes de visites reçues
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, rejected, cancelled] }
 *     responses:
 *       200:
 *         description: Liste des visites
 */
router.get('/visits', ctrl.getMyVisits);

/**
 * @swagger
 * /landlord/properties/{id}/status:
 *   patch:
 *     tags: [Landlord]
 *     summary: Changer le statut d'une propriété (libre ↔ occupé)
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [available, occupied]
 *     responses:
 *       200:
 *         description: Statut mis à jour
 */
router.patch('/properties/:id/status', ctrl.updateMyPropertyStatus);

module.exports = router;
