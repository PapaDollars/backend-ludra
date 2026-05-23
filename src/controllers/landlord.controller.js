const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');

exports.getStats = async (req, res) => {
  const landlordId = req.user.id;

  const snap = await db.collection('properties')
    .where('landlordId', '==', landlordId)
    .where('isActive', '==', true)
    .get();

  const properties = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const total = properties.length;
  const available = properties.filter((p) => p.status === 'available').length;
  const occupied = properties.filter((p) => p.status === 'occupied').length;
  const pending = properties.filter((p) => p.status === 'pending').length;

  const monthlyRevenue = properties
    .filter((p) => p.status === 'occupied')
    .reduce((sum, p) => sum + (p.price || 0), 0);

  const averagePrice = total > 0
    ? properties.reduce((sum, p) => sum + (p.price || 0), 0) / total
    : 0;

  const occupancyRate = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const availableRate = total > 0 ? Math.round((available / total) * 100) : 0;
  const pendingRate = total > 0 ? Math.round((pending / total) * 100) : 0;

  const typesStats = properties.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1;
    return acc;
  }, {});

  const locationStats = properties.reduce((acc, p) => {
    acc[p.location] = (acc[p.location] || 0) + 1;
    return acc;
  }, {});

  // Notifications non lues
  const [unreadContactsSnap, pendingVisitsSnap] = await Promise.all([
    db.collection('contacts').where('landlordId', '==', landlordId).where('isRead', '==', false).get(),
    db.collection('visits').where('landlordId', '==', landlordId).where('status', '==', 'pending').get(),
  ]);

  return ApiResponse.success(res, {
    total,
    available,
    occupied,
    pending,
    monthlyRevenue,
    averagePrice: Math.round(averagePrice),
    occupancyRate,
    availableRate,
    pendingRate,
    typesStats,
    locationStats,
    notifications: {
      unreadContacts: unreadContactsSnap.size,
      pendingVisits: pendingVisitsSnap.size,
    },
    recentProperties: properties
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3),
  });
};

exports.getMyProperties = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));

  let query = db.collection('properties')
    .where('landlordId', '==', req.user.id);

  if (status) query = query.where('status', '==', status);

  const snap = await query.get();
  let properties = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  properties.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = properties.length;
  const paginated = properties.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  // Attacher les infos du propriétaire (c'est l'utilisateur connecté lui-même)
  const landlordInfo = { name: req.user.name, avatar: req.user.avatar || null };
  const result = paginated.map((p) => ({ ...p, landlord: landlordInfo }));

  return ApiResponse.paginated(res, result, pageNum, limitNum, total);
};

exports.getMyContacts = async (req, res) => {
  const { unreadOnly, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));

  let query = db.collection('contacts').where('landlordId', '==', req.user.id);
  if (unreadOnly === 'true') query = query.where('isRead', '==', false);

  const snap = await query.get();
  let contacts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  contacts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = contacts.length;
  const paginated = contacts.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return ApiResponse.paginated(res, paginated, pageNum, limitNum, total);
};

exports.getMyVisits = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));

  let query = db.collection('visits').where('landlordId', '==', req.user.id);
  if (status) query = query.where('status', '==', status);

  const snap = await query.get();
  let visits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  visits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = visits.length;
  const paginated = visits.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return ApiResponse.paginated(res, paginated, pageNum, limitNum, total);
};

exports.updateMyPropertyStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['available', 'occupied'].includes(status)) {
    return ApiResponse.badRequest(res, 'Statut invalide. Valeurs autorisées: available, occupied');
  }

  const doc = await db.collection('properties').doc(id).get();
  if (!doc.exists) return ApiResponse.notFound(res, 'Propriété introuvable');

  const property = doc.data();
  if (property.landlordId !== req.user.id) return ApiResponse.forbidden(res, 'Accès refusé');
  if (!property.isActive) return ApiResponse.badRequest(res, "Impossible de modifier une propriété désactivée par l'administration");
  if (property.status === 'pending') return ApiResponse.badRequest(res, "Propriété en attente d'approbation");

  await doc.ref.update({ status, updatedAt: new Date().toISOString() });
  return ApiResponse.success(res, { id, status }, 'Statut mis à jour');
};
