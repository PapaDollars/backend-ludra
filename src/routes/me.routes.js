const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const personnel = require('../controllers/personnel.controller');

// Espace « Mon compte » V2.1 (contrat étape 10). Les autres routes /me/* sont à ajouter ici.
router.use(authenticate);

/**
 * @swagger
 * /me/candidate-profile:
 *   get:
 *     tags: [Personnel]
 *     summary: Mon profil candidat (CandidateFeedItem) ou null
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: CandidateFeedItem | null
 */
router.get('/candidate-profile', personnel.getMyCandidateProfile);

module.exports = router;
