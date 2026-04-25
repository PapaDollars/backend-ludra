const { db } = require('../config/firebase');
const { createNotification } = require('../utils/notifications');
const { uploadMultipleToCloudinary } = require('../middleware/upload');
const ApiResponse = require('../utils/ApiResponse');

const VALID_LOCATIONS = ['douala', 'yaounde', 'bafoussam', 'garoua', 'ngaoundere', 'limbe', 'kribi', 'bamenda'];
const VALID_TYPES = ['apartment', 'studio', 'house', 'room', 'loft'];

exports.getProperties = async (req, res) => {
  const {
    search, location, type, status,
    minPrice, maxPrice, beds, baths,
    page = 1, limit = 20, sortBy = 'newest',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

  let query = db.collection('properties').where('isActive', '==', true);

  const canSeeAll = req.user && ['admin', 'landlord'].includes(req.user.role);
  if (status) {
    query = query.where('status', '==', status);
  }

  if (location && VALID_LOCATIONS.includes(location)) {
    query = query.where('location', '==', location);
  }

  if (type && VALID_TYPES.includes(type)) {
    query = query.where('type', '==', type);
  }

  const snap = await query.get();
  let properties = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Filtres post-fetch (Firestore ne supporte pas plusieurs range queries)
  if (minPrice) properties = properties.filter((p) => p.price >= Number(minPrice));
  if (maxPrice) properties = properties.filter((p) => p.price <= Number(maxPrice));
  if (beds) {
    const b = beds === '5+' ? 5 : parseInt(beds);
    properties = properties.filter((p) => (beds === '5+' ? p.beds >= b : p.beds === b));
  }
  if (baths) {
    const b = baths === '4+' ? 4 : parseInt(baths);
    properties = properties.filter((p) => (baths === '4+' ? p.baths >= b : p.baths === b));
  }
  // Le public ne voit pas les propriétés en attente d'approbation
  if (!canSeeAll) {
    properties = properties.filter((p) => p.status !== 'pending');
  }

  if (search) {
    const term = search.toLowerCase();
    properties = properties.filter(
      (p) => p.title.toLowerCase().includes(term) || p.address?.toLowerCase().includes(term)
    );
  }

  // Tri
  if (sortBy === 'price_asc') properties.sort((a, b) => a.price - b.price);
  else if (sortBy === 'price_desc') properties.sort((a, b) => b.price - a.price);
  else if (sortBy === 'rating_desc') properties.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else properties.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // newest

  const total = properties.length;
  const paginated = properties.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  // Masquer les infos de contact si non connecté
  const result = paginated.map((p) => {
    if (!req.user) {
      const { landlordPhone, landlordEmail, ...rest } = p;
      return rest;
    }
    return p;
  });

  return ApiResponse.paginated(res, result, pageNum, limitNum, total);
};

exports.getFeaturedProperties = async (req, res) => {
  const snap = await db.collection('properties')
    .where('featured', '==', true)
    .where('status', '==', 'available')
    .where('isActive', '==', true)
    .limit(6)
    .get();

  const properties = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return ApiResponse.success(res, properties);
};

exports.getPropertyById = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('properties').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  const property = { id: doc.id, ...doc.data() };

  if (!property.isActive && req.user?.role !== 'admin') {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  // Récupérer les infos publiques du propriétaire
  const landlordDoc = await db.collection('users').doc(property.landlordId).get();
  if (landlordDoc.exists) {
    const { name, avatar, city } = landlordDoc.data();
    property.landlord = { id: landlordDoc.id, name, avatar, city };

    // Infos de contact uniquement pour les utilisateurs connectés
    if (req.user) {
      const { phone } = landlordDoc.data();
      property.landlord.phone = phone;
    }
  }

  return ApiResponse.success(res, property);
};

exports.createProperty = async (req, res) => {
  const {
    title, type, price, location, beds, baths, area,
    address, description, latitude, longitude, featured, amenities,
  } = req.body;

  const landlordId = req.user.role === 'admin' && req.body.landlordId
    ? req.body.landlordId
    : req.user.id;

  let imageUrls = [];
  let imagePublicIds = [];
  if (req.files && req.files.length > 0) {
    const uploaded = await uploadMultipleToCloudinary(req.files, 'properties');
    imageUrls = uploaded.map((r) => r.url);
    imagePublicIds = uploaded.map((r) => r.publicId);
  }

  let parsedAmenities = [];
  try {
    parsedAmenities = amenities ? JSON.parse(amenities) : [];
  } catch {
    parsedAmenities = [];
  }

  const now = new Date().toISOString();
  const propertyData = {
    title: title.trim(),
    type,
    price: Number(price),
    location,
    status: 'pending', // En attente de validation admin par défaut
    rating: 0,
    image: imageUrls[0] || '',
    images: imageUrls,
    imagePublicIds,
    beds: parseInt(beds),
    baths: parseInt(baths),
    area: Number(area),
    featured: featured === 'true' || featured === true,
    description: description?.trim() || '',
    address: address.trim(),
    latitude: latitude ? parseFloat(latitude) : null,
    longitude: longitude ? parseFloat(longitude) : null,
    amenities: parsedAmenities,
    landlordId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  // Les admins peuvent publier directement
  if (req.user.role === 'admin') {
    propertyData.status = 'available';
  }

  const docRef = await db.collection('properties').add(propertyData);

  // Notifier tous les admins si la propriété est en attente (rôle landlord)
  if (propertyData.status === 'pending') {
    const landlordName = req.user.name || 'Un propriétaire';
    const adminSnap = await db.collection('users')
      .where('role', '==', 'admin')
      .where('isActive', '==', true)
      .get();
    await Promise.all(adminSnap.docs.map((adminDoc) =>
      createNotification(adminDoc.id, {
        type: 'pending_property',
        title: 'Nouvelle propriété en attente',
        message: `${landlordName} a soumis "${propertyData.title}" (${propertyData.type}, ${propertyData.location}) — ${Number(price).toLocaleString('fr-FR')} FCFA/mois.`,
        propertyId: docRef.id,
        propertyTitle: propertyData.title,
      })
    ));
  }

  return ApiResponse.created(res, { id: docRef.id, ...propertyData }, 'Propriété créée avec succès');
};

exports.updateProperty = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('properties').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  const property = doc.data();

  // Vérifier ownership (sauf admin)
  if (req.user.role !== 'admin' && property.landlordId !== req.user.id) {
    return ApiResponse.forbidden(res, 'Vous ne pouvez modifier que vos propres propriétés');
  }

  const allowed = ['title', 'type', 'price', 'location', 'beds', 'baths', 'area', 'address', 'description', 'latitude', 'longitude', 'featured', 'amenities'];
  const updates = { updatedAt: new Date().toISOString() };

  allowed.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (updates.price) updates.price = Number(updates.price);
  if (updates.beds) updates.beds = parseInt(updates.beds);
  if (updates.baths) updates.baths = parseInt(updates.baths);
  if (updates.area) updates.area = Number(updates.area);
  if (updates.amenities) {
    try { updates.amenities = JSON.parse(updates.amenities); } catch { delete updates.amenities; }
  }

  // Nouvelles images
  if (req.files && req.files.length > 0) {
    const uploaded = await uploadMultipleToCloudinary(req.files, 'properties');
    updates.images = uploaded.map((r) => r.url);
    updates.imagePublicIds = uploaded.map((r) => r.publicId);
    updates.image = updates.images[0];
  }

  await doc.ref.update(updates);

  const updated = await doc.ref.get();
  return ApiResponse.success(res, { id, ...updated.data() }, 'Propriété mise à jour');
};

exports.updatePropertyStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const doc = await db.collection('properties').doc(id).get();
  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  if (req.user.role !== 'admin' && doc.data().landlordId !== req.user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  await doc.ref.update({ status, updatedAt: new Date().toISOString() });

  return ApiResponse.success(res, { id, status }, 'Statut mis à jour');
};

exports.deleteProperty = async (req, res) => {
  const { id } = req.params;
  const doc = await db.collection('properties').doc(id).get();

  if (!doc.exists) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  if (req.user.role !== 'admin' && doc.data().landlordId !== req.user.id) {
    return ApiResponse.forbidden(res, 'Accès refusé');
  }

  await doc.ref.delete();

  return ApiResponse.success(res, null, 'Propriété supprimée');
};
