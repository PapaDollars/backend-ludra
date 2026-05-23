const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { isPrivileged } = require('../middleware/role');

exports.requestVisit = async (req, res) => {
  const { propertyId, preferredDate, message } = req.body;
  const user = req.user;

  const propDoc = await db.collection('properties').doc(propertyId).get();
  if (!propDoc.exists || !propDoc.data().isActive) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  const property = propDoc.data();

  if (property.status !== 'available') {
    return ApiResponse.badRequest(res, 'Cette propriété n\'est pas disponible pour une visite');
  }

  if (property.landlordId === user.id) {
    return ApiResponse.badRequest(res, 'Vous ne pouvez pas visiter votre propre propriété');
  }

  // Vérifier qu'il n'y a pas déjà une demande en cours
  const existingSnap = await db.collection('visits')
    .where('propertyId', '==', propertyId)
    .where('userId', '==', user.id)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    return ApiResponse.badRequest(res, 'Vous avez déjà une demande de visite en attente pour cette propriété');
  }

  const now = new Date().toISOString();
  const visitData = {
    propertyId,
    propertyTitle: property.title,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userPhone: user.phone,
    landlordId: property.landlordId,
    preferredDate: new Date(preferredDate).toISOString(),
    message: message?.trim() || '',
    status: 'pending',
    responseMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await db.collection('visits').add(visitData);

  return ApiResponse.created(res, { id: docRef.id, ...visitData }, 'Demande de visite envoyée');
};

exports.getVisits = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, parseInt(limit));
  const user = req.user;

  let query = db.collection('visits');

  if (user.role === 'landlord') {
    query = query.where('landlordId', '==', user.id);
  } else if (user.role === 'user') {
    query = query.where('userId', '==', user.id);
  }

  const snap = await query.get();
  let visits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (status) {
    visits = visits.filter((v) => v.status === status);
  }

  visits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = visits.length;
  const paginated = visits.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return ApiResponse.paginated(res, paginated, pageNum, limitNum, total);
};

exports.getVisitById = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('visits').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Visite introuvable');
  }

  const visit = { id: doc.id, ...doc.data() };
  const user = req.user;

  if (!isPrivileged(user.role) && visit.userId !== user.id && visit.landlordId !== user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  return ApiResponse.success(res, visit);
};

exports.respondToVisit = async (req, res) => {
  const { id } = req.params;
  const { status, responseMessage } = req.body;

  const doc = await db.collection('visits').doc(id).get();
  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Visite introuvable');
  }

  const visit = doc.data();

  if (!isPrivileged(req.user.role) && visit.landlordId !== req.user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  if (visit.status !== 'pending') {
    return ApiResponse.badRequest(res, 'Cette demande a déjà été traitée');
  }

  await doc.ref.update({
    status,
    responseMessage: responseMessage?.trim() || null,
    updatedAt: new Date().toISOString(),
  });

  const msg = status === 'confirmed' ? 'Visite confirmée' : 'Visite rejetée';
  return ApiResponse.success(res, null, msg);
};

exports.cancelVisit = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('visits').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Visite introuvable');
  }

  const visit = doc.data();

  if (visit.userId !== req.user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  if (!['pending', 'confirmed'].includes(visit.status)) {
    return ApiResponse.badRequest(res, 'Cette visite ne peut plus être annulée');
  }

  await doc.ref.update({ status: 'cancelled', updatedAt: new Date().toISOString() });

  return ApiResponse.success(res, null, 'Visite annulée');
};
