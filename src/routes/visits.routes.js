const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const ctrl = require('../controllers/visits.controller');

/**
 * @swagger
 * /visits:
 *   post:
 *     tags: [Visits]
 *     summary: Demander une visite pour une propriété
 *     description: L'utilisateur connecté envoie une demande de visite
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, preferredDate]
 *             properties:
 *               propertyId:
 *                 type: string
 *               preferredDate:
 *                 type: string
 *                 format: date-time
 *               message:
 *                 type: string
 *     responses:
 *       201:
 *         description: Demande de visite créée
 */
router.post(
  '/',
  authenticate,
  requireRole('user', 'admin'),
  [
    body('propertyId').notEmpty().withMessage('ID propriété requis'),
    body('preferredDate').isISO8601().withMessage('Date invalide (format ISO8601)').toDate(),
    body('message').optional().trim(),
  ],
  validate,
  ctrl.requestVisit
);

/**
 * @swagger
 * /visits:
 *   get:
 *     tags: [Visits]
 *     summary: Lister les visites (reçues pour landlord, propres pour user)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, rejected, cancelled] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Liste des visites
 */
router.get('/', authenticate, ctrl.getVisits);

/**
 * @swagger
 * /visits/{id}:
 *   get:
 *     tags: [Visits]
 *     summary: Détail d'une visite
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Détail de la visite
 */
router.get('/:id', authenticate, ctrl.getVisitById);

/**
 * @swagger
 * /visits/{id}/respond:
 *   patch:
 *     tags: [Visits]
 *     summary: Confirmer ou rejeter une demande de visite (landlord)
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
 *                 enum: [confirmed, rejected]
 *               responseMessage:
 *                 type: string
 *     responses:
 *       200:
 *         description: Réponse enregistrée
 */
router.patch(
  '/:id/respond',
  authenticate,
  requireRole('landlord', 'admin'),
  [body('status').isIn(['confirmed', 'rejected']).withMessage('Statut invalide')],
  validate,
  ctrl.respondToVisit
);

/**
 * @swagger
 * /visits/{id}/cancel:
 *   patch:
 *     tags: [Visits]
 *     summary: Annuler une demande de visite (user)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Visite annulée
 */
router.patch('/:id/cancel', authenticate, requireRole('user'), ctrl.cancelVisit);

module.exports = router;
