const { admin, db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');

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

const userNotifications = (userId) => db.collection('notifications').where('userId', '==', userId);

/**
 * Requêtes « non lues ». Champ canonique : `isRead` (V1 et nouvelles notifications).
 * Seules quelques notifications créées entre deux versions n'ont que `read: false` : elles sont
 * couvertes par la 2e requête. Aucun document n'a les deux champs à false, donc pas de doublon.
 */
const unreadQueries = (userId) => [
  userNotifications(userId).where('isRead', '==', false),
  userNotifications(userId).where('read', '==', false),
];

/** Nombre de non lues : 2 agrégations count() (1 lecture chacune par tranche de 1 000). */
const countUnread = async (userId) => {
  const counts = await Promise.all(unreadQueries(userId).map((q) => q.count().get()));
  return counts.reduce((sum, c) => sum + c.data().count, 0);
};

// Curseur opaque : date + id du dernier élément renvoyé
const encodeCursor = (n) => Buffer.from(JSON.stringify({ c: n.createdAt, i: n.id })).toString('base64url');
const decodeCursor = (cursor) => {
  try {
    const { c, i } = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
    return typeof c === 'string' && typeof i === 'string' ? { c, i } : null;
  } catch { return null; }
};

const isMissingIndex = (err) => err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(err.message || ''));
let warnedMissingIndex = false;

/**
 * Lecture paginée côté Firestore : seuls `limit + 1` documents sont lus.
 * Ordre identique à l'ancienne version : date décroissante, puis id croissant à date égale.
 * Index composite requis (firestore.indexes.json) : userId ASC, createdAt DESC, __name__ ASC.
 */
const readPage = async (userId, cursor, size) => {
  let q = userNotifications(userId)
    .orderBy('createdAt', 'desc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'asc');
  const after = cursor ? decodeCursor(cursor) : null;
  if (after) q = q.startAfter(after.c, after.i);
  const snap = await q.limit(size + 1).get();
  const items = snap.docs.slice(0, size).map((d) => toAppNotification(d.id, d.data()));
  return { items, nextCursor: snap.docs.length > size ? encodeCursor(items[items.length - 1]) : null };
};

/** Ancienne méthode (lit toutes les notifications) : uniquement si l'index n'est pas encore créé. */
const readPageWithoutIndex = async (userId, cursor, size) => {
  const snap = await userNotifications(userId).get();
  const docs = snap.docs.map((d) => toAppNotification(d.id, d.data()));
  docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const after = cursor ? decodeCursor(cursor) : null;
  const start = after ? docs.findIndex((n) => n.id === after.i) + 1 : 0;
  const items = docs.slice(start, start + size);
  return { items, nextCursor: start + size < docs.length ? encodeCursor(items[items.length - 1]) : null };
};

/** GET /notifications?cursor=&limit= → `NotificationPage` (plus récentes d'abord). */
exports.getNotifications = async (req, res) => {
  const { cursor, limit = 20 } = req.query;
  const size = Math.min(100, Math.max(1, Number(limit) || 20));

  let page;
  try {
    page = await readPage(req.user.id, cursor, size);
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    if (!warnedMissingIndex) {
      warnedMissingIndex = true;
      // Le message Firestore contient un lien qui crée l'index en un clic
      console.warn('[notifications] Index composite manquant — lecture complète en attendant. Créer l\'index :', err.message);
    }
    page = await readPageWithoutIndex(req.user.id, cursor, size);
  }

  const unread = await countUnread(req.user.id);
  return ApiResponse.success(res, { ...page, unread });
};

/** POST /notifications/:id/read */
exports.markAsRead = async (req, res) => {
  const doc = await db.collection('notifications').doc(req.params.id).get();
  if (!doc.exists || doc.data().userId !== req.user.id) {
    return ApiResponse.notFound(res, 'Notification introuvable');
  }
  if (isUnread(doc.data())) await doc.ref.update({ read: true, isRead: true }); // déjà lue : pas d'écriture
  return ApiResponse.success(res, null, 'Marquée comme lue');
};

/** POST /notifications/read-all — ne lit et n'écrit que les non lues. */
exports.markAllAsRead = async (req, res) => {
  const snaps = await Promise.all(unreadQueries(req.user.id).map((q) => q.get()));
  const unread = [...new Map(snaps.flatMap((s) => s.docs).map((d) => [d.id, d])).values()];

  // Firestore : 500 écritures maximum par batch
  for (let i = 0; i < unread.length; i += 500) {
    const batch = db.batch();
    unread.slice(i, i + 500).forEach((d) => batch.update(d.ref, { read: true, isRead: true }));
    await batch.commit();
  }
  return ApiResponse.success(res, null, `${unread.length} notification(s) marquée(s) comme lue(s)`);
};

/** Nombre de notifications non lues (réutilisable par GET /me/counters). */
exports.countUnread = countUnread;
