const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const ctrl = require('../controllers/users.controller');

/**
 * @swagger
 * /users/profile:
 *   put:
 *     tags: [Users]
 *     summary: Mettre à jour son profil
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               city: { type: string }
 *     responses:
 *       200:
 *         description: Profil mis à jour
 */
router.put(
  '/profile',
  authenticate,
  [
    body('name').optional().trim().isLength({ min: 2 }),
    body('phone').optional().matches(/^(\+237|237)?[6|2|3]\d{8}$/),
    body('city').optional().trim(),
    body('whatsapp').optional({ checkFalsy: true }).matches(/^(\+237|237)?[62369]\d{8}$/),
  ],
  validate,
  ctrl.updateProfile
);

/**
 * @swagger
 * /users/profile/avatar:
 *   post:
 *     tags: [Users]
 *     summary: Mettre à jour l'avatar
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar mis à jour
 */
router.post('/profile/avatar', authenticate, upload.single('avatar'), ctrl.updateAvatar);

/**
 * @swagger
 * /users/request-deletion:
 *   post:
 *     tags: [Users]
 *     summary: Demander la suppression de son compte
 *     description: >
 *       L'utilisateur demande la suppression de son compte. Un délai de 72h est accordé
 *       avant que l'admin puisse supprimer définitivement. La connexion avant expiration
 *       du délai annule automatiquement la demande.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Demande de suppression enregistrée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     deletionRequestedAt: { type: string, format: date-time }
 *                     deletionScheduledAt: { type: string, format: date-time, description: "Date limite (72h après la demande)" }
 *       400:
 *         description: Demande déjà en cours
 */
router.post('/request-deletion', authenticate, ctrl.demanderSuppression);

/**
 * @swagger
 * /users/cancel-deletion:
 *   post:
 *     tags: [Users]
 *     summary: Annuler la demande de suppression de son compte
 *     description: Annule une demande de suppression en attente. Accessible uniquement si une demande est en cours.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Demande de suppression annulée
 *       400:
 *         description: Aucune demande de suppression en cours
 */
router.post('/cancel-deletion', authenticate, ctrl.annulerSuppression);

module.exports = router;
