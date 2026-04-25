const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/notifications.controller');

/**
 * @swagger
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Récupérer les notifications de l'utilisateur connecté
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30 }
 *     responses:
 *       200:
 *         description: Liste des notifications + compteur non lues
 */
router.get('/', authenticate, ctrl.getNotifications);

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Marquer toutes les notifications comme lues
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Toutes les notifications marquées comme lues
 */
router.patch('/read-all', authenticate, ctrl.markAllAsRead);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Marquer une notification comme lue
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification marquée comme lue
 */
router.patch('/:id/read', authenticate, ctrl.markAsRead);

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     tags: [Notifications]
 *     summary: Supprimer une notification
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification supprimée
 */
router.delete('/:id', authenticate, ctrl.deleteNotification);

module.exports = router;
