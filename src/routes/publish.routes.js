const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { uploadPublicationFile } = require('../middleware/upload');
const ctrl = require('../controllers/publish.controller');

/** Publication « + Publier » (module 06) — deux routeurs montés dans routes/index.js : `/drafts`, `/uploads`. */

// ─── /drafts ─────────────────────────────────────────────────────────────────
const drafts = express.Router();
drafts.use(authenticate);

/**
 * @swagger
 * /drafts:
 *   get:
 *     tags: [Publication]
 *     summary: Mes brouillons (PublishDraft[], plus récents d'abord)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: PublishDraft[]
 *   post:
 *     tags: [Publication]
 *     summary: Créer un brouillon (body = PublishDraftPatch, au minimum { type, step })
 *     description: "onBehalfOf: { userId } réservé à la permission add_property."
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: PublishDraft
 *       409:
 *         description: DRAFT_LIMIT (30 brouillons maximum)
 */
drafts.get('/', ctrl.listDrafts);
drafts.post('/', ctrl.createDraft);

/**
 * @swagger
 * /drafts/{id}:
 *   get:
 *     tags: [Publication]
 *     summary: Reprendre un brouillon (404 si publié ou supprimé)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: PublishDraft
 *   patch:
 *     tags: [Publication]
 *     summary: Sauvegarde automatique — remplace les champs envoyés, sans validation métier bloquante
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: PublishDraft
 *   delete:
 *     tags: [Publication]
 *     summary: Supprimer un brouillon
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Supprimé
 */
drafts.get('/:id', ctrl.getDraft);
drafts.patch('/:id', ctrl.updateDraft);
drafts.delete('/:id', ctrl.deleteDraft);

/**
 * @swagger
 * /drafts/{id}/publish:
 *   post:
 *     tags: [Publication]
 *     summary: Valider et publier (PublishResult) — univers personnel uniquement pour l'instant
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "PublishResult { status: published | pending_review | pending_kyc, universe, itemId }"
 *       422:
 *         description: "VALIDATION_ERROR + errors[{ field, message }]"
 *       501:
 *         description: NOT_IMPLEMENTED (immobilier, services)
 */
drafts.post('/:id/publish', ctrl.publishDraft);

// ─── /uploads ────────────────────────────────────────────────────────────────
const uploads = express.Router();

// 30 images par minute et par adresse IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Trop d\'envois d\'images, réessayez dans une minute.' },
});

/**
 * @swagger
 * /uploads:
 *   post:
 *     tags: [Publication]
 *     summary: Téléverser une image de publication (JPG/PNG/WebP ≤ 10 Mo) → UploadedMedia
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *               purpose: { type: string, enum: [publication_media] }
 *     responses:
 *       201:
 *         description: "UploadedMedia { id, url, type: image }"
 *       413:
 *         description: FILE_TOO_LARGE
 *       422:
 *         description: UNSUPPORTED_FORMAT
 */
uploads.post('/', authenticate, uploadLimiter, uploadPublicationFile, ctrl.upload);

module.exports = { drafts, uploads };
