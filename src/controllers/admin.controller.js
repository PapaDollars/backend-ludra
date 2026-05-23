const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { isPrivileged } = require('../middleware/role');
const { createNotification, createAdminLog } = require('../utils/notifications');

async function fetchLandlordMap(landlordIds) {
  const uniqueIds = [...new Set(landlordIds.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const docs = await Promise.all(uniqueIds.map((id) => db.collection('users').doc(id).get()));
  const map = {};
  docs.forEach((doc) => {
    if (doc.exists) { const { name, avatar } = doc.data(); map[doc.id] = { name, avatar: avatar || null }; }
  });
  return map;
}

const formatUser = (id, data) => {
  const { passwordHash, refreshToken, resetPasswordToken, resetPasswordExpiry, ...safe } = data;
  return { id, ...safe };
};

// ─── STATISTIQUES ────────────────────────────────────────────────────────────

exports.getGlobalStats = async (req, res) => {
  const [propertiesSnap, usersSnap, contactsSnap, visitsSnap] = await Promise.all([
    db.collection('properties').where('isActive', '==', true).get(),
    db.collection('users').where('isActive', '==', true).get(),
    db.collection('contacts').get(),
    db.collection('visits').get(),
  ]);

  const properties = propertiesSnap.docs.map((d) => d.data());
  const users = usersSnap.docs.map((d) => d.data());

  const totalProperties = properties.length;
  const available = properties.filter((p) => p.status === 'available').length;
  const occupied = properties.filter((p) => p.status === 'occupied').length;
  const pending = properties.filter((p) => p.status === 'pending').length;

  const monthlyRevenue = properties
    .filter((p) => p.status === 'occupied')
    .reduce((sum, p) => sum + (p.price || 0), 0);

  const averagePrice = totalProperties > 0
    ? properties.reduce((sum, p) => sum + (p.price || 0), 0) / totalProperties
    : 0;

  const typesStats = properties.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {});

  const locationStats = properties.reduce((acc, p) => {
    acc[p.location] = (acc[p.location] || 0) + 1;
    return acc;
  }, {});

  const totalUsers = users.length;
  const totalLandlords = users.filter((u) => u.role === 'landlord').length;
  const totalRegularUsers = users.filter((u) => u.role === 'user').length;
  const totalAdmins = users.filter((u) => isPrivileged(u.role)).length;

  return ApiResponse.success(res, {
    properties: {
      total: totalProperties,
      available,
      occupied,
      pending,
      occupancyRate: totalProperties > 0 ? Math.round((occupied / totalProperties) * 100) : 0,
      availableRate: totalProperties > 0 ? Math.round((available / totalProperties) * 100) : 0,
      monthlyRevenue,
      averagePrice: Math.round(averagePrice),
      typesStats,
      locationStats,
    },
    users: {
      total: totalUsers,
      landlords: totalLandlords,
      regularUsers: totalRegularUsers,
      admins: totalAdmins,
    },
    activity: {
      totalContacts: contactsSnap.size,
      totalVisits: visitsSnap.size,
      pendingVisits: visitsSnap.docs.filter((d) => d.data().status === 'pending').length,
    },
  });
};

// ─── USERS ───────────────────────────────────────────────────────────────────

exports.getAllUsers = async (req, res) => {
  const { role, isActive, search, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, parseInt(limit));

  let query = db.collection('users');
  if (role) query = query.where('role', '==', role);
  if (isActive !== undefined) query = query.where('isActive', '==', isActive === 'true');

  const snap = await query.get();
  let users = snap.docs
    .map((d) => formatUser(d.id, d.data()))
    .filter((u) => u.role !== 'proprietaire');  // Le compte propriétaire n'apparaît pas dans la liste

  if (search) {
    const term = search.toLowerCase();
    users = users.filter(
      (u) => u.name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term) || u.phone?.includes(term)
    );
  }

  users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = users.length;
  const paginated = users.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return ApiResponse.paginated(res, paginated, pageNum, limitNum, total);
};

exports.createUser = async (req, res) => {
  const { name, email, phone, password, role, city, adminPermissions } = req.body;

  // Seul un compte ayant add_admin peut créer un administrateur
  if (role === 'admin') {
    const perms = req.user.adminPermissions || [];
    if (!isPrivileged(req.user.role) && !perms.includes('add_admin')) {
      return ApiResponse.forbidden(res, 'Permission insuffisante pour créer un administrateur');
    }
  }

  const usersRef = db.collection('users');

  const [emailSnap, phoneSnap] = await Promise.all([
    usersRef.where('email', '==', email).limit(1).get(),
    usersRef.where('phone', '==', phone).limit(1).get(),
  ]);

  if (!emailSnap.empty) return ApiResponse.badRequest(res, 'Email déjà utilisé');
  if (!phoneSnap.empty) return ApiResponse.badRequest(res, 'Téléphone déjà utilisé');

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  const userData = {
    name: name.trim(),
    email,
    phone,
    role,
    city: city || '',
    avatar: null,
    emailVerified: true, // Créé par admin = déjà vérifié
    phoneVerified: false,
    isActive: true,
    passwordHash,
    refreshToken: null,
    createdAt: now,
    updatedAt: now,
    ...(isPrivileged(role) && {
      adminPermissions: Array.isArray(adminPermissions) ? adminPermissions : [],
    }),
  };

  const docRef = await usersRef.add(userData);
  return ApiResponse.created(res, formatUser(docRef.id, userData), 'Utilisateur créé');
};

exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('users').doc(id).get();

  if (!doc.exists) return ApiResponse.notFound(res, 'Utilisateur introuvable');

  // Seul un compte ayant add_admin peut élever un utilisateur au rang admin
  if (req.body.role === 'admin') {
    const perms = req.user.adminPermissions || [];
    if (!isPrivileged(req.user.role) && !perms.includes('add_admin')) {
      return ApiResponse.forbidden(res, 'Permission insuffisante pour attribuer le rôle administrateur');
    }
  }

  const allowed = ['name', 'phone', 'city', 'role', 'emailVerified', 'phoneVerified', 'adminPermissions'];
  const updates = { updatedAt: new Date().toISOString() };
  allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  // Si le rôle change vers non-admin, supprimer les permissions
  if (req.body.role && !isPrivileged(req.body.role)) updates.adminPermissions = [];

  await doc.ref.update(updates);
  const updated = await doc.ref.get();
  return ApiResponse.success(res, formatUser(id, updated.data()), 'Utilisateur mis à jour');
};

exports.changeUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (id === req.user.id) {
    return ApiResponse.badRequest(res, 'Vous ne pouvez pas modifier votre propre rôle');
  }

  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Utilisateur introuvable');

  const currentRole = doc.data().role;
  if (isPrivileged(currentRole)) {
    return ApiResponse.forbidden(res, 'Impossible de modifier le rôle d\'un administrateur');
  }

  // Seul un compte ayant add_admin peut promouvoir un utilisateur au rang admin
  if (role === 'admin') {
    const perms = req.user.adminPermissions || [];
    if (!isPrivileged(req.user.role) && !perms.includes('add_admin')) {
      return ApiResponse.forbidden(res, 'Permission insuffisante pour attribuer le rôle administrateur');
    }
  }

  const userData = doc.data();
  await doc.ref.update({ role, updatedAt: new Date().toISOString() });

  const actionLabel = role === 'landlord' ? 'promu propriétaire' : 'rétrogradé locataire';
  await createAdminLog(req.user.id, req.user.name || 'Admin', {
    action: role === 'landlord' ? 'promote_landlord' : 'demote_user',
    targetType: 'user',
    targetId: id,
    targetName: userData.name || userData.email,
    details: `Rôle changé : ${currentRole} → ${role}`,
  });

  return ApiResponse.success(res, { id, role }, `Utilisateur ${actionLabel}`);
};

exports.toggleUserStatus = async (req, res) => {
  const { id } = req.params;
  const { isActive, reason } = req.body;
  const { MAIN_OWNER_EMAIL } = require('../middleware/role');

  if (id === req.user.id) {
    return ApiResponse.badRequest(res, 'Vous ne pouvez pas désactiver votre propre compte');
  }

  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Utilisateur introuvable');

  const userData = doc.data();
  // Seul le compte propriétaire peut activer/désactiver un admin
  if (isPrivileged(userData.role) && req.user.email !== MAIN_OWNER_EMAIL) {
    return ApiResponse.forbidden(res, 'Seul le compte propriétaire peut modifier le statut d\'un administrateur');
  }

  await doc.ref.update({
    isActive,
    deactivationReason: isActive ? null : (reason || ''),
    updatedAt: new Date().toISOString(),
  });

  await createAdminLog(req.user.id, req.user.name || 'Admin', {
    action: isActive ? 'activate_user' : 'deactivate_user',
    targetType: 'user',
    targetId: id,
    targetName: userData.name || userData.email,
    details: isActive ? 'Compte réactivé' : `Compte désactivé${reason ? ` — raison : ${reason}` : ''}`,
  });

  const msg = isActive ? 'Compte activé' : 'Compte désactivé';
  return ApiResponse.success(res, { id, isActive }, msg);
};

exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return ApiResponse.badRequest(res, 'Vous ne pouvez pas supprimer votre propre compte');
  }

  const doc = await db.collection('users').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Utilisateur introuvable');

  const userData = doc.data();
  await doc.ref.update({ isActive: false, deletedAt: new Date().toISOString() });

  await createAdminLog(req.user.id, req.user.name || 'Admin', {
    action: 'delete_user',
    targetType: 'user',
    targetId: id,
    targetName: userData.name || userData.email,
    details: 'Suppression de compte (soft delete)',
  });

  return ApiResponse.success(res, null, 'Utilisateur supprimé');
};

// ─── PROPERTIES ──────────────────────────────────────────────────────────────

exports.getAllProperties = async (req, res) => {
  const { status, isActive, landlordId, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, parseInt(limit));

  let query = db.collection('properties');
  if (status) query = query.where('status', '==', status);
  if (isActive !== undefined) query = query.where('isActive', '==', isActive === 'true');
  if (landlordId) query = query.where('landlordId', '==', landlordId);

  const snap = await query.get();
  let properties = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  properties.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = properties.length;
  const paginated = properties.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  const landlordMap = await fetchLandlordMap(paginated.map((p) => p.landlordId));
  const result = paginated.map((p) => ({ ...p, landlord: landlordMap[p.landlordId] || null }));

  return ApiResponse.paginated(res, result, pageNum, limitNum, total);
};

exports.updatePropertyAdmin = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('properties').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Propriété introuvable');

  const property = doc.data();
  const allowed = ['status', 'isActive', 'featured'];
  const updates = { updatedAt: new Date().toISOString() };
  allowed.forEach((f) => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  await doc.ref.update(updates);

  // ── Récupérer le nom du propriétaire pour les logs ─────────────────────────
  const adminName = req.user.name || 'Admin';
  const propTitle = property.title || 'Propriété';
  let landlordName = 'Inconnu';
  try {
    const landlordDoc = await db.collection('users').doc(property.landlordId).get();
    if (landlordDoc.exists) landlordName = landlordDoc.data().name || 'Inconnu';
  } catch { /* silencieux */ }

  // ── Notification propriétaire + log admin ──────────────────────────────────
  if (updates.isActive === true) {
    // Réactivation après désactivation admin
    await createNotification(property.landlordId, {
      type: 'property_approved',
      title: 'Propriété réactivée',
      message: `Votre propriété "${propTitle}" a été réactivée par l'administration et est à nouveau visible.`,
      propertyId: id,
      propertyTitle: propTitle,
    });
    await createAdminLog(req.user.id, adminName, {
      action: 'reactivate_property',
      targetType: 'property',
      targetId: id,
      targetName: propTitle,
      details: `Réactivée — Propriétaire : ${landlordName}`,
    });
  } else if (updates.status === 'available' && !updates.isActive) {
    // Première approbation (pending → available)
    await createNotification(property.landlordId, {
      type: 'property_approved',
      title: 'Propriété approuvée !',
      message: `Votre propriété "${propTitle}" a été approuvée et est maintenant visible par tous les visiteurs.`,
      propertyId: id,
      propertyTitle: propTitle,
    });
    await createAdminLog(req.user.id, adminName, {
      action: 'approve_property',
      targetType: 'property',
      targetId: id,
      targetName: propTitle,
      details: `Approuvée — Propriétaire : ${landlordName}`,
    });
  } else if (updates.isActive === false) {
    await createNotification(property.landlordId, {
      type: 'property_rejected',
      title: 'Propriété désactivée',
      message: `Votre propriété "${propTitle}" a été désactivée par l'administration.`,
      propertyId: id,
      propertyTitle: propTitle,
    });
    await createAdminLog(req.user.id, adminName, {
      action: 'deactivate_property',
      targetType: 'property',
      targetId: id,
      targetName: propTitle,
      details: `Désactivée — Propriétaire : ${landlordName}`,
    });
  } else {
    await createAdminLog(req.user.id, adminName, {
      action: 'update_property',
      targetType: 'property',
      targetId: id,
      targetName: propTitle,
      details: `Modifiée — Propriétaire : ${landlordName}`,
    });
  }

  return ApiResponse.success(res, { id, ...updates }, 'Propriété mise à jour');
};

exports.deletePropertyAdmin = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('properties').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Propriété introuvable');

  const property = doc.data();
  await doc.ref.delete();

  await createAdminLog(req.user.id, req.user.name || 'Admin', {
    action: 'delete_property',
    targetType: 'property',
    targetId: id,
    targetName: property.title || 'Propriété',
    details: 'Suppression définitive',
  });

  return ApiResponse.success(res, null, 'Propriété supprimée');
};

// ─── FILTRES CONFIGURABLES ────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  locations: ['douala', 'yaounde', 'bafoussam', 'garoua', 'ngaoundere', 'limbe', 'kribi', 'bamenda'],
  propertyTypes: ['apartment', 'studio', 'house', 'room', 'loft'],
  amenities: ['wifi', 'parking', 'security', 'garden', 'gym', 'pool', 'ac', 'furnished', 'balcony', 'elevator'],
};

// ─── HISTORIQUE DES ACTIONS ADMIN ────────────────────────────────────────────

exports.getAdminLogs = async (req, res) => {
  const { page = 1, limit = 50, action, adminId } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, parseInt(limit));

  let query = db.collection('adminLogs');
  if (adminId) query = query.where('adminId', '==', adminId);
  if (action) query = query.where('action', '==', action);

  const snap = await query.get();
  let logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = logs.length;
  const paginated = logs.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return ApiResponse.paginated(res, paginated, pageNum, limitNum, total);
};

exports.getFilters = async (req, res) => {
  const doc = await db.collection('config').doc('filters').get();
  const filters = doc.exists ? doc.data() : DEFAULT_FILTERS;
  return ApiResponse.success(res, filters);
};

exports.updateFilters = async (req, res) => {
  const { locations, propertyTypes, amenities } = req.body;
  const updates = {};
  if (locations) updates.locations = locations;
  if (propertyTypes) updates.propertyTypes = propertyTypes;
  if (amenities) updates.amenities = amenities;

  await db.collection('config').doc('filters').set(updates, { merge: true });
  return ApiResponse.success(res, updates, 'Filtres mis à jour');
};
