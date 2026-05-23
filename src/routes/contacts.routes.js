const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const ctrl = require('../controllers/contacts.controller');

// Formulaire de contact général (public, sans authentification)
router.post(
  '/general',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Nom requis'),
    body('email').isEmail().withMessage('Email invalide'),
    body('subject').trim().notEmpty().withMessage('Sujet requis'),
    body('message').trim().isLength({ min: 10 }).withMessage('Message trop court'),
  ],
  validate,
  ctrl.sendGeneralContact
);

/**
 * @swagger
 * /contacts:
 *   post:
 *     tags: [Contacts]
 *     summary: Envoyer un message au propriétaire d'une propriété
 *     description: Requiert une connexion. Les visiteurs voient un popup de connexion.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [propertyId, message]
 *             properties:
 *               propertyId:
 *                 type: string
 *               message:
 *                 type: string
 *                 minLength: 10
 *     responses:
 *       201:
 *         description: Message envoyé au propriétaire
 */
router.post(
  '/',
  authenticate,
  requireRole('user', 'landlord', 'admin'),
  [
    body('propertyId').notEmpty().withMessage('ID propriété requis'),
    body('message').trim().isLength({ min: 10 }).withMessage('Message trop court (min 10 car.)'),
  ],
  validate,
  ctrl.sendContact
);

/**
 * @swagger
 * /contacts:
 *   get:
 *     tags: [Contacts]
 *     summary: Lister les contacts (reçus pour landlord, envoyés pour user)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Liste des contacts paginée
 */
router.get('/', authenticate, ctrl.getContacts);

/**
 * @swagger
 * /contacts/{id}:
 *   get:
 *     tags: [Contacts]
 *     summary: Détail d'un contact
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Détail du contact
 */
router.get('/:id', authenticate, ctrl.getContactById);

/**
 * @swagger
 * /contacts/{id}/read:
 *   patch:
 *     tags: [Contacts]
 *     summary: Marquer un contact comme lu (landlord uniquement)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Contact marqué comme lu
 */
router.patch('/:id/read', authenticate, requireRole('landlord', 'admin'), ctrl.markAsRead);

module.exports = router;
