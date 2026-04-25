const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
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
 * /users/change-password:
 *   put:
 *     tags: [Users]
 *     summary: Changer son mot de passe
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword, confirmPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *               confirmPassword: { type: string }
 *     responses:
 *       200:
 *         description: Mot de passe modifié
 */
router.put(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.newPassword) throw new Error('Les mots de passe ne correspondent pas');
      return true;
    }),
  ],
  validate,
  ctrl.changePassword
);

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Obtenir le profil public d'un utilisateur
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Profil utilisateur
 */
/**
 * @swagger
 * /users/become-landlord:
 *   patch:
 *     tags: [Users]
 *     summary: Demander la mise à niveau du compte en propriétaire
 *     description: "Réservé aux locataires (role=user). Requiert: nom complet + photo de profil."
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [fullName]
 *             properties:
 *               fullName:
 *                 type: string
 *                 description: Prénom et nom (doit correspondre à la CNI)
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Compte mis à niveau en propriétaire
 *       400:
 *         description: Photo ou nom manquant
 *       403:
 *         description: Déjà propriétaire ou admin
 */
router.patch('/become-landlord', authenticate, requireRole('user'), upload.single('avatar'), ctrl.becomeLandlord);

router.get('/:id', authenticate, ctrl.getUserById);

module.exports = router;
