const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');

async function fetchLandlordMap(landlordIds) {
  const uniqueIds = [...new Set(landlordIds.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const docs = await Promise.all(uniqueIds.map((id) => db.collection('users').doc(id).get()));
  const map = {};
  docs.forEach((doc) => {
    if (doc.exists) {
      const { name, avatar } = doc.data();
      map[doc.id] = { name, avatar: avatar || null };
    }
  });
  return map;
}

const getFavDoc = (userId) => db.collection('favorites').doc(userId);

exports.getFavorites = async (req, res) => {
  const favDoc = await getFavDoc(req.user.id).get();

  if (!favDoc.exists || !favDoc.data().propertyIds?.length) {
    return ApiResponse.success(res, []);
  }

  const propertyIds = favDoc.data().propertyIds;

  // Récupérer les propriétés en batch (Firestore max 10 par 'in')
  const chunks = [];
  for (let i = 0; i < propertyIds.length; i += 10) {
    chunks.push(propertyIds.slice(i, i + 10));
  }

  const propertiesList = [];
  for (const chunk of chunks) {
    const snap = await db.collection('properties')
      .where('__name__', 'in', chunk)
      .where('isActive', '==', true)
      .get();
    snap.docs.forEach((d) => propertiesList.push({ id: d.id, ...d.data() }));
  }

  const landlordMap = await fetchLandlordMap(propertiesList.map((p) => p.landlordId));
  const result = propertiesList.map((p) => ({ ...p, landlord: landlordMap[p.landlordId] || null }));

  return ApiResponse.success(res, result);
};

exports.addFavorite = async (req, res) => {
  const { propertyId } = req.params;

  const propDoc = await db.collection('properties').doc(propertyId).get();
  if (!propDoc.exists || !propDoc.data().isActive) {
    return ApiResponse.notFound(res, 'Propriété introuvable');
  }

  const favRef = getFavDoc(req.user.id);
  const favDoc = await favRef.get();

  if (!favDoc.exists) {
    await favRef.set({ userId: req.user.id, propertyIds: [propertyId], updatedAt: new Date().toISOString() });
  } else {
    const ids = favDoc.data().propertyIds || [];
    if (!ids.includes(propertyId)) {
      await favRef.update({
        propertyIds: [...ids, propertyId],
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return ApiResponse.success(res, { propertyId, isFavorite: true }, 'Ajouté aux favoris');
};

exports.removeFavorite = async (req, res) => {
  const { propertyId } = req.params;
  const favRef = getFavDoc(req.user.id);
  const favDoc = await favRef.get();

  if (favDoc.exists) {
    const ids = (favDoc.data().propertyIds || []).filter((id) => id !== propertyId);
    await favRef.update({ propertyIds: ids, updatedAt: new Date().toISOString() });
  }

  return ApiResponse.success(res, { propertyId, isFavorite: false }, 'Retiré des favoris');
};

exports.toggleFavorite = async (req, res) => {
  const { propertyId } = req.params;
  const favRef = getFavDoc(req.user.id);
  const favDoc = await favRef.get();

  const ids = favDoc.exists ? (favDoc.data().propertyIds || []) : [];
  const isFavorite = ids.includes(propertyId);

  if (isFavorite) {
    const newIds = ids.filter((id) => id !== propertyId);
    await favRef.set({ userId: req.user.id, propertyIds: newIds, updatedAt: new Date().toISOString() });
    return ApiResponse.success(res, { propertyId, isFavorite: false }, 'Retiré des favoris');
  } else {
    const propDoc = await db.collection('properties').doc(propertyId).get();
    if (!propDoc.exists || !propDoc.data().isActive) {
      return ApiResponse.notFound(res, 'Propriété introuvable');
    }
    await favRef.set({ userId: req.user.id, propertyIds: [...ids, propertyId], updatedAt: new Date().toISOString() });
    return ApiResponse.success(res, { propertyId, isFavorite: true }, 'Ajouté aux favoris');
  }
};
