const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { isPrivileged } = require('../middleware/role');
const { cursorPage } = require('../utils/pagination');
const { createAuditEntry } = require('../utils/audit');

// Permissions RBAC V2.1 (miroir de frontend-ludra/src/lib/adminPermissions.ts)
const ADMIN_PERMISSIONS = [
  'manage_users', 'add_admin', 'manage_properties', 'add_property', 'review_kyc', 'moderate_reviews',
  'handle_reports', 'view_payments', 'manage_payments', 'manage_settings', 'view_audit',
];
const ASSIGNABLE_ROLES = ['user', 'landlord', 'admin'];
const MIN_REASON = 5;

const hasPerm = (user, perm) => user.role === 'proprietaire' || (user.adminPermissions || []).includes(perm);

/** Document Firestore → `AdminUser` (aucun secret exposé). */
const toAdminUser = (id, d) => ({
  id,
  name: d.name || '',
  email: d.email || '',
  ...(d.phone && { phone: d.phone }),
  role: d.role,
  adminPermissions: isPrivileged(d.role) ? (d.adminPermissions || []) : [],
  isActive: d.isActive !== false,
  kycStatus: d.kycStatus || 'a_completer',
  createdAt: d.createdAt,
});

// ─── STATISTIQUES ────────────────────────────────────────────────────────────

/** GET /admin/stats → `AdminStats`. */
exports.getStats = async (req, res) => {
  const usersSnap = await db.collection('users').get();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const users = usersSnap.docs.map((d) => d.data()).filter((u) => u.role !== 'proprietaire');

  return ApiResponse.success(res, {
    users: users.length,
    usersNew7d: users.filter((u) => u.createdAt && new Date(u.createdAt).getTime() >= weekAgo).length,
    // À calculer quand les collections V2.1 existeront (KYC, annonces, signalements, preuves, paiements).
    pendingKyc: 0,
    pendingListings: 0,
    openReports: 0,
    pendingProofs: 0,
    paymentsToday: 0,
    paymentsTodayCount: 0,
    failedPayments24h: 0,
  });
};

// ─── UTILISATEURS ────────────────────────────────────────────────────────────

/** GET /admin/users?q=&role=&cursor= → `CursorPage<AdminUser>`. */
exports.getUsers = async (req, res) => {
  const { q, role, cursor, limit = 20 } = req.query;
  const canSeeAdmins = hasPerm(req.user, 'add_admin');

  if (role === 'admin' && !canSeeAdmins) {
    return ApiResponse.forbidden(res, 'Permission insuffisante pour filtrer par administrateur');
  }

  let query = db.collection('users');
  if (role) query = query.where('role', '==', role);
  const snap = await query.get();

  let users = snap.docs
    .map((d) => toAdminUser(d.id, d.data()))
    .filter((u) => u.role !== 'proprietaire') // le compte principal n'apparaît jamais
    .filter((u) => canSeeAdmins || u.role !== 'admin');

  if (q) {
    const term = String(q).toLowerCase();
    users = users.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || (u.phone || '').includes(term));
  }

  users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return ApiResponse.success(res, cursorPage(users, cursor, limit));
};

/**
 * PATCH /admin/users/:id { role?, adminPermissions?, isActive?, reason? } → `AdminUser`.
 * Rôle / permissions : `add_admin`. Compte `proprietaire` non modifiable. Suspension : motif obligatoire.
 */
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { role, adminPermissions, isActive, reason } = req.body;

  if (id === req.user.id) return ApiResponse.badRequest(res, 'Vous ne pouvez pas modifier votre propre compte');

  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Utilisateur introuvable');
  const target = doc.data();

  if (target.role === 'proprietaire') return ApiResponse.forbidden(res, 'Le compte principal n\'est pas modifiable');

  const touchesRights = role !== undefined || adminPermissions !== undefined;
  if ((touchesRights || isPrivileged(target.role)) && !hasPerm(req.user, 'add_admin')) {
    return ApiResponse.forbidden(res, 'Permission insuffisante pour modifier un rôle ou un administrateur');
  }
  if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
    return ApiResponse.error(res, 'Rôle invalide', 422);
  }
  if (adminPermissions !== undefined
    && (!Array.isArray(adminPermissions) || adminPermissions.some((p) => !ADMIN_PERMISSIONS.includes(p)))) {
    return ApiResponse.error(res, 'Permissions invalides', 422);
  }
  if (isActive !== undefined && typeof isActive !== 'boolean') {
    return ApiResponse.error(res, 'isActive doit être un booléen', 422);
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (isActive === false && trimmedReason.length < MIN_REASON) {
    return ApiResponse.error(res, `Motif obligatoire (${MIN_REASON} caractères minimum)`, 422);
  }

  const before = toAdminUser(id, target);
  const updates = { updatedAt: new Date().toISOString() };
  if (role !== undefined) updates.role = role;
  const finalRole = role ?? target.role;
  if (!isPrivileged(finalRole)) updates.adminPermissions = [];
  else if (adminPermissions !== undefined) updates.adminPermissions = [...new Set(adminPermissions)];
  if (isActive !== undefined) {
    updates.isActive = isActive;
    updates.deactivationReason = isActive ? null : trimmedReason;
    if (!isActive) updates.refreshToken = null; // déconnexion forcée
  }

  await doc.ref.update(updates);
  const after = toAdminUser(id, { ...target, ...updates });

  const changes = [];
  if (before.role !== after.role) changes.push({ field: 'role', from: before.role, to: after.role });
  if (before.adminPermissions.join(',') !== after.adminPermissions.join(',')) {
    changes.push({ field: 'adminPermissions', from: before.adminPermissions.join(', ') || '—', to: after.adminPermissions.join(', ') || '—' });
  }
  if (before.isActive !== after.isActive) changes.push({ field: 'isActive', from: String(before.isActive), to: String(after.isActive) });

  if (changes.length) {
    const action = before.isActive !== after.isActive ? (after.isActive ? 'user.restore' : 'user.suspend') : 'user.update';
    await createAuditEntry(req.user, {
      action, targetType: 'user', targetId: id, targetLabel: target.name || target.email,
      ...(trimmedReason && { reason: trimmedReason }), changes,
    });
  }

  return ApiResponse.success(res, after, 'Utilisateur mis à jour');
};
