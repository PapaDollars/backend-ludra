const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const ApiResponse = require('../utils/ApiResponse');
const svc = require('../services/messaging.service');

const router = express.Router();
router.use(authenticate);

// Le front envoie du multipart (text? + image?). Les images ne sont pas encore prises en charge : le champ est lu
// (5 Mo max, en mémoire) pour pouvoir répondre proprement, puis refusé.
const form = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });
const parseForm = (req, res, next) => form.single('image')(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, code: 'FILE_TOO_LARGE', message: 'Image trop volumineuse (5 Mo maximum).' });
  return res.status(400).json({ success: false, message: 'Message invalide.' });
});

// Anti-spam : 30 messages par minute et par utilisateur → 429
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user.id,
  message: { success: false, code: 'RATE_LIMITED', message: 'Vous envoyez trop de messages, réessayez dans une minute.' },
});

/**
 * @swagger
 * /conversations:
 *   get:
 *     tags: [Messagerie]
 *     summary: Mes conversations non vides, la plus récente d'abord (CursorPage<Conversation>)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: "Filtre sur le nom du participant ou le titre de l'objet (sans curseur)" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *     responses:
 *       200:
 *         description: CursorPage<Conversation>
 */
router.get('/', async (req, res) => ApiResponse.success(res, await svc.listConversations(req.user, req.query)));

/**
 * @swagger
 * /conversations/open:
 *   post:
 *     tags: [Messagerie]
 *     summary: Trouver ou créer une conversation (idempotent). Vers un candidat actif ⇒ droit « contact » du forfait recruteur.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientId]
 *             properties:
 *               recipientId: { type: string }
 *               itemId: { type: string, description: "Id du profil candidat (seul objet géré aujourd'hui)" }
 *     responses:
 *       200:
 *         description: Conversation
 *       400:
 *         description: SELF_CONVERSATION
 *       403:
 *         description: PLAN_REQUIRED
 *       404:
 *         description: Destinataire ou objet introuvable
 */
router.post('/open', async (req, res) => ApiResponse.success(res, await svc.openConversation(req.user, req.body || {})));

/**
 * @swagger
 * /conversations/{id}:
 *   get:
 *     tags: [Messagerie]
 *     summary: Détail d'une conversation (participants uniquement, 404 sinon)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Conversation
 */
router.get('/:id', async (req, res) => ApiResponse.success(res, await svc.getConversation(req.user, req.params.id)));

/**
 * @swagger
 * /conversations/{id}/messages:
 *   get:
 *     tags: [Messagerie]
 *     summary: Historique (before) ou nouveaux messages (after), ordre chronologique
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: before, schema: { type: string } }
 *       - { in: query, name: after, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, default: 30, maximum: 50 } }
 *     responses:
 *       200:
 *         description: CursorPage<Message>
 *   post:
 *     tags: [Messagerie]
 *     summary: Envoyer un message (multipart text? + image?) — coordonnées et liens masqués par le serveur
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Message tel que modéré
 *       403:
 *         description: BLOCKED ou PLAN_REQUIRED (forfait recruteur expiré)
 *       429:
 *         description: RATE_LIMITED
 *       501:
 *         description: NOT_IMPLEMENTED (image)
 */
router.get('/:id/messages', async (req, res) => ApiResponse.success(res, await svc.listMessages(req.user, req.params.id, req.query)));
router.post('/:id/messages', sendLimiter, parseForm, async (req, res) => {
  if (req.file) {
    return res.status(501).json({ success: false, code: 'NOT_IMPLEMENTED', message: 'L’envoi d’images n’est pas encore disponible.' });
  }
  return ApiResponse.success(res, await svc.sendMessage(req.user, req.params.id, req.body || {}));
});

router.post('/:id/read', async (req, res) => { await svc.markRead(req.user, req.params.id); return ApiResponse.success(res, null); });

/**
 * @swagger
 * /conversations/{id}/block:
 *   post:
 *     tags: [Messagerie]
 *     summary: Bloquer l'autre participant
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Conversation
 *   delete:
 *     tags: [Messagerie]
 *     summary: Débloquer
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Conversation
 */
router.post('/:id/block', async (req, res) => ApiResponse.success(res, await svc.setBlocked(req.user, req.params.id, true)));
router.delete('/:id/block', async (req, res) => ApiResponse.success(res, await svc.setBlocked(req.user, req.params.id, false)));

module.exports = router;
