const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { isPrivileged } = require('../middleware/role');
const { cursorPage } = require('../utils/pagination');
const { createAuditEntry } = require('../utils/audit');
const { getAllUsers, invalidateUser } = require('../utils/userCache');
const { AppError, notFound, validationError } = require('../utils/AppError');
const { createNotification } = require('../utils/notifications');
const { invalidateCandidate } = require('../services/candidates.service');
const { reconcilePaymentForAdmin, listAdminPayments, paymentStatsToday } = require('../services/payments.service');

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
  // Agrégations count() : 1 lecture facturée par tranche de 1 000 documents, au lieu de lire
  // toute la collection. Le compte principal (exclu des totaux) est lu à part (1 document).
  const usersRef = db.collection('users');
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [allCount, recentCount, ownersSnap, proofsCount] = await Promise.all([
    usersRef.count().get(),
    usersRef.where('createdAt', '>=', weekAgo.toISOString()).count().get(),
    usersRef.where('role', '==', 'proprietaire').get(),
    db.collection('proofs').where('status', '==', 'a_verifier').count().get(),
  ]);
  // Un index manquant ou une erreur ponctuelle ne doit pas casser tout le tableau de bord
  const paymentStats = await paymentStatsToday().catch((err) => {
    console.error('[admin/stats] Chiffres de paiement indisponibles :', err.message);
    return { paymentsToday: 0, paymentsTodayCount: 0, failedPayments24h: 0 };
  });
  const owners = ownersSnap.docs.map((d) => d.data());
  const recentOwners = owners.filter((u) => u.createdAt && new Date(u.createdAt) >= weekAgo).length;

  return ApiResponse.success(res, {
    users: allCount.data().count - owners.length,
    usersNew7d: recentCount.data().count - recentOwners,
    // À calculer quand les collections V2.1 existeront (KYC, annonces, signalements, paiements).
    pendingKyc: 0,
    pendingListings: 0,
    openReports: 0,
    pendingProofs: proofsCount.data().count,
    ...paymentStats,
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

  // Liste en cache 2 min (utils/userCache.js) : la recherche plein texte se fait en mémoire,
  // donc une page ou une frappe ne relit plus toute la collection.
  const all = await getAllUsers();

  let users = all
    .filter((d) => !role || d.data.role === role)
    .map((d) => toAdminUser(d.id, d.data))
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
  if (!isPrivileged(finalRole)) { if ((target.adminPermissions || []).length) updates.adminPermissions = []; }
  else if (adminPermissions !== undefined) updates.adminPermissions = [...new Set(adminPermissions)];
  if (isActive !== undefined) {
    updates.isActive = isActive;
    updates.deactivationReason = isActive ? null : trimmedReason;
    if (!isActive) updates.refreshToken = null; // déconnexion forcée
  }

  // Rien ne change (ex. même rôle renvoyé) : pas d'écriture inutile
  const changed = Object.keys(updates).some((k) => k !== 'updatedAt' && JSON.stringify(target[k] ?? null) !== JSON.stringify(updates[k] ?? null));
  if (changed) {
    await doc.ref.update(updates);
    invalidateUser(id);
  }
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

// ─── PREUVES « FORMÉ » / HABILITATIONS ───────────────────────────────────────
// Collection `proofs` : une preuve `training` est créée à la publication d'un profil candidat avec une
// formation (services/candidates.service.js). Le badge « Formé » n'est activé qu'après validation ici.

const PROOF_STATUSES = ['a_verifier', 'valide', 'rejete'];

/** Document → `AdminProof`. */
const toAdminProof = (id, d) => ({
  id,
  kind: d.kind,
  userName: d.userName || '',
  itemId: d.itemId,
  itemTitle: d.itemTitle || '',
  label: d.label || '',
  submittedAt: d.submittedAt,
  status: d.status,
});

const isMissingIndex = (err) => err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(err.message || ''));

/** GET /admin/proofs?status= → `AdminProof[]` (plus récentes d'abord, 100 max). Permission `review_kyc`. */
exports.getProofs = async (req, res) => {
  const status = PROOF_STATUSES.includes(req.query.status) ? req.query.status : 'a_verifier';
  const base = db.collection('proofs').where('status', '==', status);
  let docs;
  try {
    // Index composite status + submittedAt (firestore.indexes.json)
    docs = (await base.orderBy('submittedAt', 'desc').limit(100).get()).docs;
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    console.warn('[admin/proofs] Index composite manquant — tri en mémoire :', err.message);
    docs = (await base.get()).docs.sort((a, b) => String(b.data().submittedAt).localeCompare(String(a.data().submittedAt))).slice(0, 100);
  }
  return ApiResponse.success(res, docs.map((d) => toAdminProof(d.id, d.data())));
};

/**
 * POST /admin/proofs/:id/decision { decision: approve | reject, reason? } — permission `review_kyc`.
 * `approve` d'une preuve `training` ⇒ badge « Formé » activé sur le profil candidat. Motif obligatoire pour un refus.
 */
exports.decideProof = async (req, res) => {
  const { decision, reason } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) {
    throw validationError([{ field: 'decision', message: 'Décision invalide (approve | reject).' }]);
  }
  const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  if (decision === 'reject' && trimmedReason.length < MIN_REASON) {
    throw validationError([{ field: 'reason', message: 'Motif obligatoire.' }], `Motif obligatoire (${MIN_REASON} caractères minimum).`);
  }

  if (!req.params.id || req.params.id.includes('/')) throw notFound('Preuve introuvable');
  const ref = db.collection('proofs').doc(req.params.id);
  const now = new Date().toISOString();
  const proof = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('Preuve introuvable');
    const p = snap.data();
    if (p.status !== 'a_verifier') throw new AppError('Cette preuve a déjà été traitée.', 409, 'ALREADY_DECIDED');

    const candidateRef = p.kind === 'training' ? db.collection('candidates').doc(p.itemId) : null;
    const candidateSnap = candidateRef ? await tx.get(candidateRef) : null;

    const status = decision === 'approve' ? 'valide' : 'rejete';
    tx.update(ref, {
      status, decidedAt: now, decidedBy: req.user.id, ...(trimmedReason && { reason: trimmedReason }),
    });
    // Badge uniquement si la formation du profil est toujours celle qui a été vérifiée
    if (candidateSnap && candidateSnap.exists && candidateSnap.data().training === p.label) {
      tx.update(candidateRef, { trained: decision === 'approve', updatedAt: now });
    }
    return { ...p, status };
  });

  if (proof.kind === 'training') invalidateCandidate(proof.itemId);
  await createAuditEntry(req.user, {
    action: `proof.${decision}`, targetType: proof.kind, targetId: proof.itemId,
    targetLabel: `${proof.userName} — ${proof.label}`, ...(trimmedReason && { reason: trimmedReason }),
  });
  const badge = proof.kind === 'training' ? 'Formé' : 'Professionnel habilité';
  await createNotification(proof.userId, decision === 'approve'
    ? { kind: 'system', title: `Badge « ${badge} » activé`, body: `Votre preuve « ${proof.label} » a été validée.`, href: `/personnel/candidats/${proof.itemId}` }
    : { kind: 'system', title: 'Preuve refusée', body: `« ${proof.label} » : ${trimmedReason}`, href: '/compte/annonces' },
  ).catch((err) => console.error('[admin/proofs] Notification non envoyée :', err.message));

  return ApiResponse.success(res, null, 'Décision enregistrée');
};

/**
 * POST /admin/payments/:id/reconcile — permission `manage_payments`.
 * Interroge l'opérateur pour un paiement `pending` sans webhook ; 409 sinon. Journalisé (`payment.reconcile`).
 */
exports.reconcilePayment = async (req, res) => {
  const payment = await reconcilePaymentForAdmin(req.params.id);
  await createAuditEntry(req.user, {
    action: 'payment.reconcile', targetType: 'payment', targetId: payment.id,
    targetLabel: `${payment.label} — ${payment.userName}`,
    ...(payment.status !== 'pending' && { changes: [{ field: 'status', from: 'pending', to: payment.status }] }),
  });
  return ApiResponse.success(res, payment, payment.status === 'pending' ? 'Toujours en attente chez l’opérateur' : 'Paiement réconcilié');
};

/** GET /admin/payments?status=&purpose= — permission `view_payments` → `AdminPayment[]` (200 plus récents). */
exports.getPayments = async (req, res) => ApiResponse.success(res, await listAdminPayments(req.query));
