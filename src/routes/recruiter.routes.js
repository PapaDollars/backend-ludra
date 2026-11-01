const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/personnel.controller');

router.use(authenticate);

/**
 * @swagger
 * /recruiter/access:
 *   get:
 *     tags: [Personnel]
 *     summary: Forfait recruteur actif et droits (RecruiterAccess)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "RecruiterAccess (planCode null et tous les droits à false sans forfait)"
 */
router.get('/access', ctrl.getAccess);

/**
 * @swagger
 * /recruiter/shortlist/export:
 *   get:
 *     tags: [Personnel]
 *     summary: Export CSV de la shortlist (droit exportShortlist) — aucune coordonnée
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Fichier CSV (UTF-8 avec BOM, séparateur ;)
 *         content:
 *           text/csv: {}
 *       403:
 *         description: PLAN_REQUIRED
 */
router.get('/shortlist/export', ctrl.exportShortlist);

/**
 * @swagger
 * /recruiter/shortlist:
 *   get:
 *     tags: [Personnel]
 *     summary: Ma shortlist (ShortlistEntry[]) — droit shortlist
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: ShortlistEntry[]
 *       403:
 *         description: PLAN_REQUIRED
 *   post:
 *     tags: [Personnel]
 *     summary: Ajouter un candidat (idempotent)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [candidateId]
 *             properties:
 *               candidateId: { type: string }
 *     responses:
 *       200:
 *         description: ShortlistEntry[]
 *       403:
 *         description: PLAN_REQUIRED
 *       404:
 *         description: Profil introuvable
 */
router.get('/shortlist', ctrl.getShortlist);
router.post('/shortlist', ctrl.addToShortlist);

/**
 * @swagger
 * /recruiter/shortlist/{candidateId}:
 *   delete:
 *     tags: [Personnel]
 *     summary: Retirer un candidat de la shortlist
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: candidateId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: ShortlistEntry[]
 *       403:
 *         description: PLAN_REQUIRED
 */
router.delete('/shortlist/:candidateId', ctrl.removeFromShortlist);

module.exports = router;
