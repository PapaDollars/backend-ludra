const { db } = require('../config/firebase');

/**
 * Journal d'audit V2.1 (`AuditEntry`, collection `auditLog`).
 * Entrées non modifiables : aucune route n'expose de mise à jour ni de suppression.
 *
 * @param {object} actor  utilisateur connecté (req.user)
 * @param {{ action: string, targetType: string, targetId: string, targetLabel: string,
 *           reason?: string, changes?: { field: string, from: string, to: string }[] }} entry
 */
const createAuditEntry = async (actor, { action, targetType, targetId, targetLabel, reason, changes }) => {
  await db.collection('auditLog').add({
    at: new Date().toISOString(),
    actor: { id: actor.id, name: actor.name || actor.email || 'Admin', role: actor.role },
    action,
    targetType,
    targetId,
    targetLabel,
    ...(reason && { reason }),
    ...(changes && changes.length && { changes }),
  });
};

module.exports = { createAuditEntry };
