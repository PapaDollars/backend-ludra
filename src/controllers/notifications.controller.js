const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { cursorPage } = require('../utils/pagination');

const KINDS = ['message', 'search_alert', 'review', 'kyc', 'payment', 'listing', 'subscription', 'system'];

// Anciens types V1 encore présents dans Firestore → `kind` V2.1
const LEGACY_KIND = {
  contact_request: 'message',
  pending_property: 'listing',
  property_approved: 'listing',
  property_rejected: 'listing',
  deletion_request: 'system',
  inscription: 'system',
};

const LEGACY_HREF = {
  pending_property: '/admin/annonces',
  property_approved: '/compte/annonces',
  property_rejected: '/compte/annonces',
  deletion_request: '/admin/utilisateurs',
  inscription: '/admin/utilisateurs',
};

/** Document Firestore (V1 ou V2.1) → `AppNotification`. */
const toAppNotification = (id, d) => ({
  id,
  kind: KINDS.includes(d.kind) ? d.kind : (LEGACY_KIND[d.type] || 'system'),
  title: d.title || '',
  body: d.body ?? d.message ?? '',
  ...((d.href || LEGACY_HREF[d.type]) && { href: d.href || LEGACY_HREF[d.type] }),
  createdAt: d.createdAt,
  read: Boolean(d.read ?? d.isRead),
});

const isUnread = (d) => !(d.read ?? d.isRead);

/** GET /notifications?cursor=&limit= → `NotificationPage` (plus récentes d'abord). */
exports.getNotifications = async (req, res) => {
  const { cursor, limit = 20 } = req.query;
  const snap = await db.collection('notifications').where('userId', '==', req.user.id).get();

  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  docs.sort((a, b) => new Date(b.data.createdAt) - new Date(a.data.createdAt));

  const unread = docs.filter((d) => isUnread(d.data)).length;
  const page = cursorPage(docs.map((d) => toAppNotification(d.id, d.data)), cursor, limit, { withTotal: false });

  return ApiResponse.success(res, { ...page, unread });
};

/** POST /notifications/:id/read */
exports.markAsRead = async (req, res) => {
  const doc = await db.collection('notifications').doc(req.params.id).get();
  if (!doc.exists || doc.data().userId !== req.user.id) {
    return ApiResponse.notFound(res, 'Notification introuvable');
  }
  await doc.ref.update({ read: true, isRead: true });
  return ApiResponse.success(res, null, 'Marquée comme lue');
};

/** POST /notifications/read-all */
exports.markAllAsRead = async (req, res) => {
  const snap = await db.collection('notifications').where('userId', '==', req.user.id).get();
  const unread = snap.docs.filter((d) => isUnread(d.data()));

  // Firestore : 500 écritures maximum par batch
  for (let i = 0; i < unread.length; i += 500) {
    const batch = db.batch();
    unread.slice(i, i + 500).forEach((d) => batch.update(d.ref, { read: true, isRead: true }));
    await batch.commit();
  }
  return ApiResponse.success(res, null, `${unread.length} notification(s) marquée(s) comme lue(s)`);
};

/** Nombre de notifications non lues (réutilisable par GET /me/counters). */
exports.countUnread = async (userId) => {
  const snap = await db.collection('notifications').where('userId', '==', userId).get();
  return snap.docs.filter((d) => isUnread(d.data())).length;
};
