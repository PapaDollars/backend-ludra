const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const personnel = require('../controllers/personnel.controller');
const ApiResponse = require('../utils/ApiResponse');
const payments = require('../services/payments.service');

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

/**
 * @swagger
 * /me/payments:
 *   get:
 *     tags: [Abonnements]
 *     summary: Mon historique de paiements (PaymentRecord[], plus récents d'abord, 100 maximum)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: PaymentRecord[] (receiptNumber pour les paiements paid)
 */
router.get('/payments', async (req, res) => ApiResponse.success(res, await payments.listMyPayments(req.user)));

/**
 * @swagger
 * /me/payments/{id}:
 *   get:
 *     tags: [Abonnements]
 *     summary: Reçu d'un de mes paiements (PaymentRecord)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: PaymentRecord
 *       404:
 *         description: Paiement introuvable
 */
router.get('/payments/:id', async (req, res) => ApiResponse.success(res, await payments.getMyPayment(req.user, req.params.id)));

/**
 * @swagger
 * /me/unlocks:
 *   get:
 *     tags: [Abonnements]
 *     summary: Contacts débloqués (ContactUnlock[]) — toujours vide tant que le déblocage de contact d'annonce n'existe pas
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "[]"
 */
router.get('/unlocks', (req, res) => ApiResponse.success(res, []));

module.exports = router;
