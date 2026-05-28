const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

const phoneRegex = /^(\+237|237)?[6|2|3]\d{8}$/;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

/**
 * @swagger
 * /auth/send-code:
 *   post:
 *     tags: [Auth]
 *     summary: Envoyer un code OTP de vérification d'email avant inscription
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Code envoyé
 *       400:
 *         description: Email déjà utilisé
 */
router.post(
  '/send-code',
  [body('email').isEmail().withMessage('Email invalide').toLowerCase()],
  validate,
  ctrl.envoyerCodeInscription
);

/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Inscription — étape A (vérifier le code) ou étape B (créer le compte)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               verifyOnly:
 *                 type: boolean
 *                 description: "true = vérifier le code OTP seulement, false/absent = créer le compte"
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *                 description: Code OTP reçu par email (requis si verifyOnly=true)
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *                 example: "+237612345678"
 *               password:
 *                 type: string
 *                 minLength: 8
 *               confirmPassword:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, landlord]
 *               city:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email vérifié (étape A)
 *       201:
 *         description: Compte créé avec succès (étape B)
 *       400:
 *         description: Code invalide / email non vérifié / données manquantes
 */
router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Email invalide').toLowerCase(),
    body('name').if(body('verifyOnly').not().equals('true')).trim().isLength({ min: 2 }).withMessage('Nom requis (min 2 caractères)'),
    body('phone').if(body('verifyOnly').not().equals('true')).matches(phoneRegex).withMessage('Numéro camerounais invalide'),
    body('password').if(body('verifyOnly').not().equals('true')).isLength({ min: 8 }).matches(passwordRegex).withMessage('Mot de passe trop faible (min 8 car., maj, min, chiffre)'),
    body('confirmPassword').if(body('verifyOnly').not().equals('true')).custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Les mots de passe ne correspondent pas');
      return true;
    }),
    body('role').if(body('verifyOnly').not().equals('true')).isIn(['user', 'landlord']).withMessage('Rôle invalide'),
    body('city').optional().trim(),
  ],
  validate,
  ctrl.register
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Connexion (email ou téléphone + mot de passe)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [emailOrPhone, password]
 *             properties:
 *               emailOrPhone:
 *                 type: string
 *                 description: Email ou numéro de téléphone
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Connexion réussie, retourne accessToken + refreshToken
 *       401:
 *         description: Identifiants incorrects
 */
router.post(
  '/login',
  [
    body('emailOrPhone').notEmpty().withMessage('Email ou téléphone requis'),
    body('password').notEmpty().withMessage('Mot de passe requis'),
  ],
  validate,
  ctrl.login
);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Renouveler le token d'accès
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nouveau accessToken
 */
router.post(
  '/refresh-token',
  [body('refreshToken').notEmpty().withMessage('Refresh token requis')],
  validate,
  ctrl.refreshToken
);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Demande de réinitialisation de mot de passe
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email de réinitialisation envoyé
 */
router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Email invalide')],
  validate,
  ctrl.forgotPassword
);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Réinitialiser le mot de passe avec un token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password, confirmPassword]
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Mot de passe réinitialisé
 */
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Token requis'),
    body('password').isLength({ min: 8 }).matches(passwordRegex).withMessage('Mot de passe trop faible'),
    body('confirmPassword').custom((val, { req }) => {
      if (val !== req.body.password) throw new Error('Les mots de passe ne correspondent pas');
      return true;
    }),
  ],
  validate,
  ctrl.resetPassword
);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Récupérer le profil de l'utilisateur connecté
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profil utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
router.get('/me', authenticate, ctrl.getMe);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Déconnexion (invalide le refresh token)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 */
router.post('/logout', authenticate, ctrl.logout);

module.exports = router;
