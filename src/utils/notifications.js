const { db } = require('../config/firebase');

/**
 * Crée une notification pour un utilisateur
 */
const createNotification = async (userId, {
  type, title, message,
  propertyId = null, propertyTitle = null,
  contactName = null, contactPhone = null, contactEmail = null,
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
    isRead: false,
    createdAt: new Date().toISOString(),
  });
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

module.exports = { createNotification, createAdminLog };
