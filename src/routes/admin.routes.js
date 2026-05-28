const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requireRole, requirePermission } = require('../middleware/role');
const { upload } = require('../middleware/upload');
const ctrl = require('../controllers/admin.controller');

router.use(authenticate, requireRole('admin', 'proprietaire'));

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Statistiques globales de la plateforme
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques complètes (propriétés, users, revenus, occupation)
 */
router.get('/stats', ctrl.getGlobalStats);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Lister tous les utilisateurs
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [user, landlord, admin] }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Liste des utilisateurs paginée
 */
router.get('/users', requirePermission('manage_users'), ctrl.getAllUsers);

/**
 * @swagger
 * /admin/users:
 *   post:
 *     tags: [Admin]
 *     summary: Créer un utilisateur (admin)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, phone, password, role]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               password: { type: string }
 *               role: { type: string, enum: [user, landlord, admin] }
 *               city: { type: string }
 *     responses:
 *       201:
 *         description: Utilisateur créé
 */
router.post(
  '/users',
  [
    body('name').trim().isLength({ min: 2 }),
    body('email').isEmail().normalizeEmail({ gmail_remove_dots: false }),
    body('phone').matches(/^(\+237|237)?[6|2|3]\d{8}$/),
    body('password').isLength({ min: 8 }),
    body('role').isIn(['user', 'landlord', 'admin']),
  ],
  validate,
  ctrl.createUser
);

/**
 * @swagger
 * /admin/users/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Modifier un utilisateur
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Utilisateur modifié
 */
router.put('/:id/users', ctrl.updateUser);

/**
 * @swagger
 * /admin/users/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Activer ou désactiver un compte utilisateur
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
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Statut mis à jour
 */
/**
 * @swagger
 * /admin/users/{id}/role:
 *   patch:
 *     tags: [Admin]
 *     summary: Changer le rôle d'un utilisateur (user ↔ landlord)
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
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [user, landlord]
 *     responses:
 *       200:
 *         description: Rôle modifié
 */
router.patch(
  '/users/:id/role',
  requirePermission('manage_users'),
  [body('role').isIn(['user', 'landlord']).withMessage('Rôle invalide (user ou landlord uniquement)')],
  validate,
  ctrl.changeUserRole
);

router.patch(
  '/users/:id/status',
  requirePermission('manage_users'),
  [body('isActive').isBoolean().withMessage('isActive doit être un booléen')],
  validate,
  ctrl.toggleUserStatus
);

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Supprimer un utilisateur
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Utilisateur supprimé
 */
router.delete('/users/:id', requirePermission('manage_users'), ctrl.deleteUser);

/**
 * @swagger
 * /admin/properties:
 *   get:
 *     tags: [Admin]
 *     summary: Lister toutes les propriétés (tous statuts inclus)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: landlordId
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Toutes les propriétés paginées
 */
router.get('/properties', requirePermission('manage_properties'), ctrl.getAllProperties);

/**
 * @swagger
 * /admin/properties/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Changer le statut d'une propriété
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
 *             properties:
 *               status: { type: string, enum: [available, occupied, pending] }
 *               isActive: { type: boolean }
 *               featured: { type: boolean }
 *     responses:
 *       200:
 *         description: Propriété mise à jour
 */
router.patch('/properties/:id/status', requirePermission('manage_properties'), ctrl.updatePropertyAdmin);

/**
 * @swagger
 * /admin/properties/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Supprimer une propriété
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Propriété supprimée
 */
router.delete('/properties/:id', requirePermission('manage_properties'), ctrl.deletePropertyAdmin);

/**
 * @swagger
 * /admin/logs:
 *   get:
 *     tags: [Admin]
 *     summary: Historique de toutes les actions administratives
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Historique paginé des actions admin
 */
router.get('/logs', ctrl.getAdminLogs);

/**
 * @swagger
 * /admin/filters:
 *   get:
 *     tags: [Admin]
 *     summary: Récupérer les options de filtres configurables
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Options de filtres
 */
router.get('/filters', ctrl.getFilters);

/**
 * @swagger
 * /admin/filters:
 *   put:
 *     tags: [Admin]
 *     summary: Mettre à jour les options de filtres (locations, types, etc.)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               locations: { type: array, items: { type: string } }
 *               propertyTypes: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Filtres mis à jour
 */
router.put('/filters', ctrl.updateFilters);

module.exports = router;
