const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/contacts.controller');

/**
 * @swagger
 * /contacts/general:
 *   post:
 *     tags: [Contacts]
 *     summary: Envoyer un message général à l'équipe Ludra (public)
 *     description: Formulaire de contact public accessible sans authentification.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, subject, message]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *               email:
 *                 type: string
 *                 format: email
 *               subject:
 *                 type: string
 *               message:
 *                 type: string
 *                 minLength: 10
 *     responses:
 *       200:
 *         description: Message envoyé avec succès
 *       400:
 *         description: Données invalides
 */
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

module.exports = router;
