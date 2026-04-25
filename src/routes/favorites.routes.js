const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/favorites.controller');

/**
 * @swagger
 * /favorites:
 *   get:
 *     tags: [Favorites]
 *     summary: Obtenir les favoris de l'utilisateur connecté
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des propriétés favorites avec leurs détails
 */
router.get('/', authenticate, ctrl.getFavorites);

/**
 * @swagger
 * /favorites/{propertyId}:
 *   post:
 *     tags: [Favorites]
 *     summary: Ajouter une propriété aux favoris
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Ajouté aux favoris
 *       404:
 *         description: Propriété introuvable
 */
router.post('/:propertyId', authenticate, ctrl.addFavorite);

/**
 * @swagger
 * /favorites/{propertyId}:
 *   delete:
 *     tags: [Favorites]
 *     summary: Retirer une propriété des favoris
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Retiré des favoris
 */
router.delete('/:propertyId', authenticate, ctrl.removeFavorite);

/**
 * @swagger
 * /favorites/{propertyId}/toggle:
 *   post:
 *     tags: [Favorites]
 *     summary: Basculer le statut favori d'une propriété
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: propertyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "Statut favori modifié, retourne isFavorite boolean"
 */
router.post('/:propertyId/toggle', authenticate, ctrl.toggleFavorite);

module.exports = router;
