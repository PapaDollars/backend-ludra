const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/personnel.controller');

/**
 * @swagger
 * /candidates/{id}:
 *   get:
 *     tags: [Personnel]
 *     summary: Profil candidat public (CandidateDetail) — jamais de coordonnées ni de documents
 *     description: Token optionnel — viewerAccess (contact / shortlist selon le forfait recruteur) et viewerIsOwner.
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: CandidateDetail
 *       404:
 *         description: Profil inconnu ou masqué (NOT_FOUND)
 */
router.get('/:id', optionalAuth, ctrl.getCandidate);

module.exports = router;
