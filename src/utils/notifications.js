const { db } = require('../config/firebase');

/**
 * Crée une notification pour un utilisateur
 */
const createNotification = async (userId, {
  type, title, message,
  propertyId = null, propertyTitle = null,
  contactName = null, contactPhone = null, contactEmail = null,
  targetUserId = null,
}) => {
  await db.collection('notifications').add({
    userId,
    type,
    title,
    message,
    propertyId,
    propertyTitle,
    contactName,
    contactPhone,
    contactEmail,
    targetUserId,
    isRead: false,
    createdAt: new Date().toISOString(),
  });
};

/**
 * Envoie une notification à tous les admins et au proprietaire
 */
const notifierTousLesAdmins = async ({ type, title, message, targetUserId = null }) => {
  const snap = await db.collection('users')
    .where('role', 'in', ['admin', 'proprietaire'])
    .get();

  const batch = db.batch();
  snap.docs.forEach(doc => {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      userId: doc.id,
      type,
      title,
      message,
      targetUserId,
      propertyId: null,
      propertyTitle: null,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      isRead: false,
      createdAt: new Date().toISOString(),
    });
  });
  await batch.commit();
};

/**
 * Crée un log d'action admin
 */
const createAdminLog = async (adminId, adminName, { action, targetType, targetId, targetName, details = null }) => {
  await db.collection('adminLogs').add({
    adminId,
    adminName,
    action,        // 'approve_property' | 'reject_property' | 'activate_user' | ...
    targetType,    // 'property' | 'user'
    targetId,
    targetName,
    details,
    createdAt: new Date().toISOString(),
  });
};

module.exports = { createNotification, createAdminLog, notifierTousLesAdmins };
