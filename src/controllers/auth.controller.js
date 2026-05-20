const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { sendResetPassword } = require('../services/email.service');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
  return { accessToken, refreshToken };
};

const formatUser = (id, data) => {
  const { passwordHash, refreshToken, resetPasswordToken, ...safe } = data;
  return { id, ...safe };
};

exports.register = async (req, res) => {
  const { name, password, role, city } = req.body;
  const email = req.body.email?.trim().toLowerCase();
  const phone = req.body.phone?.trim();

  const usersRef = db.collection('users');

  // Vérifier unicité email et téléphone
  const [emailSnap, phoneSnap] = await Promise.all([
    usersRef.where('email', '==', email).limit(1).get(),
    usersRef.where('phone', '==', phone).limit(1).get(),
  ]);

  if (!emailSnap.empty) {
    return ApiResponse.badRequest(res, 'Cet email est déjà utilisé');
  }
  if (!phoneSnap.empty) {
    return ApiResponse.badRequest(res, 'Ce numéro de téléphone est déjà utilisé');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();

  const userData = {
    name: name.trim(),
    email,
    phone,
    role,
    city: city || '',
    avatar: null,
    emailVerified: false,
    phoneVerified: false,
    isActive: true,
    passwordHash,
    refreshToken: null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await usersRef.add(userData);
  const { accessToken, refreshToken } = generateTokens(docRef.id);

  // Stocker le refresh token
  await docRef.update({ refreshToken });

  return ApiResponse.created(res, {
    user: formatUser(docRef.id, userData),
    accessToken,
    refreshToken,
  }, 'Compte créé avec succès');
};

exports.login = async (req, res) => {
  const { emailOrPhone, password } = req.body;

  const usersRef = db.collection('users');
  const isEmail = emailOrPhone.includes('@');

  const field = isEmail ? 'email' : 'phone';
  // Normaliser : lowercase pour l'email, trim pour le téléphone
  const value = isEmail ? emailOrPhone.trim().toLowerCase() : emailOrPhone.trim();
  const snap = await usersRef.where(field, '==', value).limit(1).get();

  if (snap.empty) {
    return ApiResponse.unauthorized(res, 'Identifiants incorrects');
  }

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  if (!userData.isActive) {
    const reason = userData.deactivationReason;
    const message = reason
      ? `Votre compte a été restreint par l'administrateur. Raison : ${reason}`
      : 'Votre compte a été restreint par l\'administrateur. Contactez le support pour plus d\'informations.';
    return res.status(403).json({ success: false, code: 'ACCOUNT_DISABLED', message });
  }

  const isValid = await bcrypt.compare(password, userData.passwordHash);
  if (!isValid) {
    return ApiResponse.unauthorized(res, 'Identifiants incorrects');
  }

  const { accessToken, refreshToken } = generateTokens(userDoc.id);
  await userDoc.ref.update({ refreshToken, updatedAt: new Date().toISOString() });

  return ApiResponse.success(res, {
    user: formatUser(userDoc.id, userData),
    accessToken,
    refreshToken,
  }, 'Connexion réussie');
};

exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return ApiResponse.unauthorized(res, 'Refresh token invalide ou expiré');
  }

  const userDoc = await db.collection('users').doc(decoded.id).get();
  if (!userDoc.exists) {
    return ApiResponse.unauthorized(res, 'Utilisateur introuvable');
  }

  const userData = userDoc.data();

  if (userData.refreshToken !== refreshToken) {
    return ApiResponse.unauthorized(res, 'Refresh token révoqué');
  }

  if (!userData.isActive) {
    return ApiResponse.forbidden(res, 'Compte désactivé');
  }

  const tokens = generateTokens(userDoc.id);
  await userDoc.ref.update({ refreshToken: tokens.refreshToken });

  return ApiResponse.success(res, tokens, 'Token renouvelé');
};

exports.forgotPassword = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  const snap = await db.collection('users').where('email', '==', email).limit(1).get();

  // Toujours retourner 200 pour ne pas exposer les emails existants
  if (snap.empty) {
    return ApiResponse.success(res, null, 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.');
  }

  const userDoc = snap.docs[0];
  const resetToken = uuidv4();
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h

  await userDoc.ref.update({
    resetPasswordToken: resetToken,
    resetPasswordExpiry: resetExpiry,
    updatedAt: new Date().toISOString(),
  });

  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;

  try {
    await sendResetPassword(email, resetUrl);
  } catch (emailErr) {
    console.error('[EMAIL] Échec envoi reset password:', emailErr.message);
    // On log mais on retourne quand même 200 (sécurité : ne pas révéler l'état du serveur mail)
  }

  console.log(`[DEV] Reset URL: ${resetUrl}`);

  return ApiResponse.success(res, null, 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.');
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;

  const snap = await db.collection('users').where('resetPasswordToken', '==', token).limit(1).get();

  if (snap.empty) {
    return ApiResponse.badRequest(res, 'Token invalide ou expiré');
  }

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  if (new Date(userData.resetPasswordExpiry) < new Date()) {
    return ApiResponse.badRequest(res, 'Token expiré. Veuillez faire une nouvelle demande.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await userDoc.ref.update({
    passwordHash,
    resetPasswordToken: null,
    resetPasswordExpiry: null,
    refreshToken: null,
    updatedAt: new Date().toISOString(),
  });

  return ApiResponse.success(res, null, 'Mot de passe réinitialisé avec succès');
};

exports.getMe = async (req, res) => {
  return ApiResponse.success(res, formatUser(req.user.id, req.user));
};

exports.logout = async (req, res) => {
  await db.collection('users').doc(req.user.id).update({
    refreshToken: null,
    updatedAt: new Date().toISOString(),
  });
  return ApiResponse.success(res, null, 'Déconnexion réussie');
};
