const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/search.controller');

/**
 * @swagger
 * /search/options:
 *   get:
 *     tags: [Recherche]
 *     summary: Référentiels de recherche (SearchOptions) — villes, métiers, catégories…
 *     security: []
 *     responses:
 *       200:
 *         description: SearchOptions
 */
router.get('/options', ctrl.options);

/**
 * @swagger
 * /search/suggestions:
 *   get:
 *     tags: [Recherche]
 *     summary: Autocomplétion (SearchSuggestion[], 8 max)
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, minLength: 2 }
 *     responses:
 *       200:
 *         description: SearchSuggestion[]
 */
router.get('/suggestions', ctrl.suggestions);

/**
 * @swagger
 * /search/count:
 *   get:
 *     tags: [Recherche]
 *     summary: Nombre de résultats pour des filtres — universe=personnel uniquement pour l'instant
 *     security: []
 *     parameters:
 *       - in: query
 *         name: universe
 *         required: true
 *         schema: { type: string, enum: [immobilier, personnel, services] }
 *     responses:
 *       200:
 *         description: "{ total }"
 *       501:
 *         description: Univers pas encore disponible (NOT_IMPLEMENTED)
 */
router.get('/count', ctrl.count);

/**
 * @swagger
 * /search:
 *   get:
 *     tags: [Recherche]
 *     summary: Recherche (CursorPage<FeedItem>) — universe=personnel (candidats) uniquement pour l'instant
 *     description: |
 *       Filtres personnel : q, city, district, verifiedOnly, job, experienceMin, availability, trainedOnly, salaryMax.
 *       Tris : pertinence (bonus de plan borné), pertinence_pure (sans effet des plans), recent.
 *       Token optionnel : un forfait recruteur avec le droit trainedPriority met les profils formés en avant.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: universe
 *         required: true
 *         schema: { type: string, enum: [immobilier, personnel, services] }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: job
 *         schema: { type: string, example: chauffeur }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: availability
 *         schema: { type: string, enum: [immediate, sous_15_jours, a_convenir] }
 *       - in: query
 *         name: experienceMin
 *         schema: { type: integer }
 *       - in: query
 *         name: salaryMax
 *         schema: { type: integer }
 *       - in: query
 *         name: trainedOnly
 *         schema: { type: boolean }
 *       - in: query
 *         name: verifiedOnly
 *         schema: { type: boolean }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [pertinence, pertinence_pure, recent] }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: "{ items: CandidateFeedItem[], nextCursor, total }"
 *       501:
 *         description: Univers pas encore disponible (NOT_IMPLEMENTED)
 */
router.get('/', optionalAuth, ctrl.search);

module.exports = router;
