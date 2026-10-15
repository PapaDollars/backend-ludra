const { db } = require('../config/firebase');

/**
 * Notifications V2.1 (`AppNotification`, lues par GET /notifications).
 * kind : message | search_alert | review | kyc | payment | listing | subscription | system
 * href : chemin interne du front (ex. "/messages/cv-1").
 */
const buildNotification = (userId, { kind = 'system', title, body, href = null, targetUserId = null }) => ({
  userId,
  kind,
  title,
  body,
  href,
  targetUserId,
  read: false,
  createdAt: new Date().toISOString(),
});

/** Crée une notification pour un utilisateur. */
const createNotification = async (userId, notification) => {
  await db.collection('notifications').add(buildNotification(userId, notification));
};

/** Envoie une notification à tous les admins et au compte principal. */
const notifierTousLesAdmins = async (notification) => {
  const snap = await db.collection('users')
    .where('role', 'in', ['admin', 'proprietaire'])
    .get();

  const batch = db.batch();
  snap.docs.forEach((doc) => {
    batch.set(db.collection('notifications').doc(), buildNotification(doc.id, notification));
  });
  await batch.commit();
};

module.exports = { createNotification, notifierTousLesAdmins };
