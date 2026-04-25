const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');

exports.getNotifications = async (req, res) => {
  const { unreadOnly, limit = 30 } = req.query;

  let query = db.collection('notifications').where('userId', '==', req.user.id);

  const snap = await query.get();
  let notifications = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (unreadOnly === 'true') {
    notifications = notifications.filter((n) => !n.isRead);
  }

  notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  notifications = notifications.slice(0, Number(limit));

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return ApiResponse.success(res, { notifications, unreadCount });
};

exports.markAsRead = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('notifications').doc(id).get();

  if (!doc.exists || doc.data().userId !== req.user.id) {
    return ApiResponse.notFound(res, 'Notification introuvable');
  }

  await doc.ref.update({ isRead: true });
  return ApiResponse.success(res, null, 'Marquée comme lue');
};

exports.markAllAsRead = async (req, res) => {
  const snap = await db.collection('notifications')
    .where('userId', '==', req.user.id)
    .where('isRead', '==', false)
    .get();

  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();

  return ApiResponse.success(res, null, `${snap.size} notification(s) marquée(s) comme lue(s)`);
};

exports.deleteNotification = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('notifications').doc(id).get();

  if (!doc.exists || doc.data().userId !== req.user.id) {
    return ApiResponse.notFound(res, 'Notification introuvable');
  }

  await doc.ref.delete();
  return ApiResponse.success(res, null, 'Notification supprimée');
};
