const bcrypt = require('bcryptjs');
const { db } = require('../config/firebase');
const { uploadAvatarToCloudinary } = require('../middleware/upload');
const ApiResponse = require('../utils/ApiResponse');
const { isPrivileged } = require('../middleware/role');

const formatUser = (id, data) => {
  const { passwordHash, refreshToken, resetPasswordToken, resetPasswordExpiry, ...safe } = data;
  return { id, ...safe };
};

exports.updateProfile = async (req, res) => {
  const { name, phone, city } = req.body;
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

  await db.collection('users').doc(userId).update(updates);

  const updatedDoc = await db.collection('users').doc(userId).get();
  return ApiResponse.success(res, formatUser(userId, updatedDoc.data()), 'Profil mis à jour');
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

  return ApiResponse.success(res, { avatar: avatarUrl }, 'Avatar mis à jour');
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userDoc = await db.collection('users').doc(req.user.id).get();
  const userData = userDoc.data();

  const isValid = await bcrypt.compare(currentPassword, userData.passwordHash);
  if (!isValid) {
    return ApiResponse.badRequest(res, 'Mot de passe actuel incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await userDoc.ref.update({
    passwordHash,
    refreshToken: null, // Invalider les sessions existantes
    updatedAt: new Date().toISOString(),
  });

  return ApiResponse.success(res, null, 'Mot de passe modifié. Veuillez vous reconnecter.');
};

exports.becomeLandlord = async (req, res) => {
  const userId = req.user.id;

  if (req.user.role !== 'user') {
    return ApiResponse.badRequest(res, 'Seuls les locataires peuvent effectuer cette demande');
  }

  const { fullName, whatsapp } = req.body;

  if (!fullName || fullName.trim().split(/\s+/).length < 2) {
    return ApiResponse.badRequest(res, 'Le nom complet (prénom + nom) est requis');
  }

  const updates = {
    role: 'landlord',
    name: fullName.trim(),
    ...(whatsapp ? { whatsapp: whatsapp.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };

  if (req.file) {
    try {
      const { url: avatarUrl, publicId: avatarPublicId } = await uploadAvatarToCloudinary(req.file);
      updates.avatar = avatarUrl;
      updates.avatarPublicId = avatarPublicId;
    } catch (uploadErr) {
      console.error('[Cloudinary] Upload avatar échoué:', uploadErr.message);
      return ApiResponse.error(res, 'Échec du téléversement de la photo. Vérifiez votre connexion.', 500);
    }
  } else if (!req.user.avatar) {
    return ApiResponse.badRequest(res, 'Une photo de profil est obligatoire pour devenir propriétaire');
  }

  await db.collection('users').doc(userId).update(updates);

  return ApiResponse.success(res, { role: 'landlord' }, 'Votre compte a été mis à niveau en compte propriétaire');
};

exports.getUserById = async (req, res) => {
  const { id } = req.params;
  const userDoc = await db.collection('users').doc(id).get();

  if (!userDoc.exists) {
    return ApiResponse.notFound(res, 'Utilisateur introuvable');
  }

  const userData = userDoc.data();

  // Profil public limité sauf pour admin ou soi-même
  if (!isPrivileged(req.user.role) && req.user.id !== id) {
    const { name, avatar, role, city, createdAt } = userData;
    return ApiResponse.success(res, { id, name, avatar, role, city, createdAt });
  }

  return ApiResponse.success(res, formatUser(id, userData));
};
