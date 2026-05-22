const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { upload } = require('../middleware/upload');
const ctrl = require('../controllers/properties.controller');

/**
 * @swagger
 * /properties:
 *   get:
 *     tags: [Properties]
 *     summary: Lister les propriétés avec filtres et pagination
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: location
 *         schema: { type: string, enum: [douala, yaounde, bafoussam, garoua, ngaoundere, limbe, kribi, bamenda] }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [apartment, studio, house, room, loft] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, occupied, pending] }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: beds
 *         schema: { type: integer }
 *       - in: query
 *         name: baths
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [price_asc, price_desc, rating_desc, newest] }
 *     responses:
 *       200:
 *         description: Liste des propriétés paginée
 */
router.get('/', optionalAuth, ctrl.getProperties);

/**
 * @swagger
 * /properties/featured:
 *   get:
 *     tags: [Properties]
 *     summary: Propriétés en vedette pour la page d'accueil
 *     security: []
 *     responses:
 *       200:
 *         description: Liste des propriétés en vedette
 */
router.get('/featured', ctrl.getFeaturedProperties);

/**
 * @swagger
 * /properties/{id}:
 *   get:
 *     tags: [Properties]
 *     summary: Détail d'une propriété
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Détail de la propriété (contact masqué si non connecté)
 *       404:
 *         description: Propriété introuvable
 */
router.get('/:id', optionalAuth, ctrl.getPropertyById);

/**
 * @swagger
 * /properties:
 *   post:
 *     tags: [Properties]
 *     summary: Créer une propriété (landlord ou admin)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, type, price, location, beds, baths, area, address]
 *             properties:
 *               title: { type: string }
 *               type: { type: string, enum: [apartment, studio, house, room, loft] }
 *               price: { type: number }
 *               location: { type: string }
 *               beds: { type: integer }
 *               baths: { type: integer }
 *               area: { type: number }
 *               address: { type: string }
 *               description: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               amenities: { type: string, description: "JSON array ex: [\"wifi\",\"parking\"]" }
 *               featured: { type: boolean }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Propriété créée
 */
router.post(
  '/',
  authenticate,
  requireRole('landlord', 'admin'),
  upload.array('images', 10),
  [
    body('title').trim().notEmpty().withMessage('Titre requis'),
    body('type').isIn(['apartment', 'studio', 'house', 'room']).withMessage('Type invalide'),
    body('price').isNumeric().isFloat({ min: 0 }).withMessage('Prix invalide'),
    body('location').isIn(['maroua', 'garoua', 'ngaoundere', 'bertoua', 'yaounde', 'douala', 'bafoussam', 'ebolowa', 'buea']).withMessage('Localisation invalide'),
    body('beds').isInt({ min: 0, max: 20 }).withMessage('Nombre de chambres invalide'),
    body('baths').isInt({ min: 0, max: 10 }).withMessage('Nombre de salles de bain invalide'),
    body('area').optional({ nullable: true, checkFalsy: true }).isNumeric().isFloat({ min: 1 }).withMessage('Surface invalide'),
    body('address').trim().notEmpty().withMessage('Adresse requise'),
    body('description').optional().trim(),
    body('latitude').optional().isFloat(),
    body('longitude').optional().isFloat(),
    body('featured').optional().isBoolean(),
  ],
  validate,
  ctrl.createProperty
);

/**
 * @swagger
 * /properties/{id}:
 *   put:
 *     tags: [Properties]
 *     summary: Modifier une propriété (propriétaire ou admin)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               price: { type: number }
 *               description: { type: string }
 *               beds: { type: integer }
 *               baths: { type: integer }
 *               area: { type: number }
 *               address: { type: string }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Propriété modifiée
 */
router.put(
  '/:id',
  authenticate,
  requireRole('landlord', 'admin'),
  upload.array('images', 10),
  ctrl.updateProperty
);

/**
 * @swagger
 * /properties/{id}/status:
 *   patch:
 *     tags: [Properties]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [available, occupied, pending]
 *     responses:
 *       200:
 *         description: Statut mis à jour
 */
router.patch(
  '/:id/status',
  authenticate,
  requireRole('landlord', 'admin'),
  [body('status').isIn(['available', 'occupied', 'pending']).withMessage('Statut invalide')],
  validate,
  ctrl.updatePropertyStatus
);

/**
 * @swagger
 * /properties/{id}:
 *   delete:
 *     tags: [Properties]
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
router.delete('/:id', authenticate, requireRole('landlord', 'admin'), ctrl.deleteProperty);

module.exports = router;
