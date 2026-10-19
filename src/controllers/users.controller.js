const { db } = require('../config/firebase');
const { uploadAvatarToCloudinary } = require('../middleware/upload');
const ApiResponse = require('../utils/ApiResponse');
const { invalidateUser } = require('../utils/userCache');
const { notifierTousLesAdmins } = require('../utils/notifications');

const formatUser = (id, data) => {
  const { passwordHash, refreshToken, resetPasswordToken, resetPasswordExpiry, ...safe } = data;
  return { id, ...safe };
};

exports.updateProfile = async (req, res) => {
  const { name, phone, city, whatsapp } = req.body;
  const userId = req.user.id;

  const updates = { updatedAt: new Date().toISOString() };
  if (name !== undefined) updates.name = name.trim();
  if (city !== undefined) updates.city = city.trim();

  if (phone !== undefined && phone !== req.user.phone) {
    // Vérifier que le téléphone n'est pas déjà utilisé
    const snap = await db.collection('users').where('phone', '==', phone).limit(1).get();
    if (!snap.empty && snap.docs[0].id !== userId) {
      return ApiResponse.badRequest(res, 'Ce numéro est déjà utilisé par un autre compte');
    }
    updates.phone = phone;
  }

  if (whatsapp !== undefined) updates.whatsapp = whatsapp ? whatsapp.trim() : null;

  await db.collection('users').doc(userId).update(updates);
  invalidateUser(userId);

  // Réponse construite sans relire le document (req.user vient d'être chargé par authenticate)
  const { id: _id, ...current } = req.user;
  return ApiResponse.success(res, formatUser(userId, { ...current, ...updates }), 'Profil mis à jour');
};

exports.updateAvatar = async (req, res) => {
  if (!req.file) {
    return ApiResponse.badRequest(res, 'Aucune image fournie');
  }

  const { url: avatarUrl, publicId: avatarPublicId } = await uploadAvatarToCloudinary(req.file);

  await db.collection('users').doc(req.user.id).update({
    avatar: avatarUrl,
    avatarPublicId,
    updatedAt: new Date().toISOString(),
  });
  invalidateUser(req.user.id, { list: false });

  return ApiResponse.success(res, { avatar: avatarUrl }, 'Avatar mis à jour');
};

exports.demanderSuppression = async (req, res) => {
  const userId = req.user.id;
  const userData = req.user; // déjà chargé par authenticate (pas de 2e lecture)

  // Si une demande est déjà en cours
  if (userData.deletionRequestedAt) {
    return ApiResponse.badRequest(res, 'Une demande de suppression est déjà en cours');
  }

  const deletionAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  await db.collection('users').doc(userId).update({
    deletionRequestedAt: new Date().toISOString(),
    deletionScheduledAt: deletionAt,
    updatedAt: new Date().toISOString(),
  });
  invalidateUser(userId, { list: false });

  await notifierTousLesAdmins({
    kind: 'system',
    title: 'Demande de suppression de compte',
    href: `/admin/utilisateurs?q=${encodeURIComponent(userData.email || '')}`,
    body: `${userData.name || userData.email} a demandé la suppression de son compte. Suppression prévue le ${new Date(deletionAt).toLocaleString('fr-FR')}.`,
    targetUserId: userId,
  });

  return ApiResponse.success(res, null, 'Demande de suppression enregistrée. Votre compte sera supprimé dans 72h sauf si vous vous reconnectez.');
};

exports.annulerSuppression = async (req, res) => {
  const userId = req.user.id;
  // Aucune demande en cours : rien à réécrire
  if (req.user.deletionRequestedAt || req.user.deletionScheduledAt) {
    await db.collection('users').doc(userId).update({
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      updatedAt: new Date().toISOString(),
    });
    invalidateUser(userId, { list: false });
  }
  return ApiResponse.success(res, null, 'Demande de suppression annulée');
};

