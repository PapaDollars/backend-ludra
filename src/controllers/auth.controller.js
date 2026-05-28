const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');
const { envoyerCode, sendResetPassword } = require('../services/email.service');

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

const fsAvecRetry = async (fn, tentatives = 3) => {
  for (let i = 0; i < tentatives; i++) {
    try {
      return await fn();
    } catch (err) {
      const isReseau = /ECONNRESET|socket hang up|CANCELLED/i.test(err.message);
      if (!isReseau || i === tentatives - 1) throw err;
      await new Promise(r => setTimeout(r, (i + 1) * 500));
    }
  }
};

exports.envoyerCodeInscription = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  const usersRef = db.collection('users');
  const emailSnap = await fsAvecRetry(() => usersRef.where('email', '==', email).limit(1).get());
  if (!emailSnap.empty) {
    return ApiResponse.badRequest(res, 'Cet email est déjà utilisé');
  }

  const codesRef = db.collection('codes_verification');
  const docSnap = await fsAvecRetry(() => codesRef.doc(email).get());

  let code;
  if (docSnap.exists) {
    const data = docSnap.data();
    const nonExpire = data.expireAt.toDate() > new Date();
    const nonVerifie = !data.verifie;
    if (nonExpire && nonVerifie) {
      code = data.code;
    }
  }

  if (!code) {
    code = Math.floor(100000 + Math.random() * 900000).toString();
    await fsAvecRetry(() => codesRef.doc(email).set({
      code,
      type: 'inscription',
      expireAt: new Date(Date.now() + 10 * 60 * 1000),
      verifie: false,
    }));
  }

  console.log(`[DEV] OTP ${email}: ${code}`);

  try {
    await envoyerCode(email, code, 'inscription');
  } catch (err) {
    console.error('[EMAIL] Échec envoi OTP inscription:', err.message);
    return ApiResponse.error(res, 'Impossible d\'envoyer l\'email de vérification. Réessayez.', 500);
  }

  return ApiResponse.success(res, null, 'Code de vérification envoyé');
};

exports.register = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const { verifyOnly, code } = req.body;

  const codesRef = db.collection('codes_verification');

  if (verifyOnly) {
    if (!code) return ApiResponse.badRequest(res, 'Code requis');

    const docSnap = await fsAvecRetry(() => codesRef.doc(email).get());
    if (!docSnap.exists) {
      return ApiResponse.badRequest(res, 'Aucun code envoyé pour cet email. Demandez un code d\'abord.');
    }
    const data = docSnap.data();
    if (data.verifie) {
      return ApiResponse.success(res, { valide: true }, 'Email déjà vérifié');
    }
    if (data.expireAt.toDate() < new Date()) {
      return ApiResponse.badRequest(res, 'Code expiré. Demandez un nouveau code.');
    }
    if (data.code !== code) {
      return ApiResponse.badRequest(res, 'Code incorrect');
    }
    await fsAvecRetry(() => codesRef.doc(email).update({ verifie: true }));
    return ApiResponse.success(res, { valide: true }, 'Email vérifié avec succès');
  }

  // Vérifier que l'email a bien été validé par OTP
  const docSnap = await fsAvecRetry(() => codesRef.doc(email).get());
  if (!docSnap.exists || !docSnap.data().verifie) {
    return ApiResponse.badRequest(res, 'Email non vérifié. Veuillez d\'abord vérifier votre email.');
  }

  const { name, password, role, city } = req.body;
  const phone = req.body.phone?.trim();

  const usersRef = db.collection('users');

  const [emailSnap, phoneSnap] = await Promise.all([
    fsAvecRetry(() => usersRef.where('email', '==', email).limit(1).get()),
    fsAvecRetry(() => usersRef.where('phone', '==', phone).limit(1).get()),
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
    emailVerified: true,
    phoneVerified: false,
    isActive: true,
    passwordHash,
    refreshToken: null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await fsAvecRetry(() => usersRef.add(userData));
  const { accessToken, refreshToken } = generateTokens(docRef.id);

  await fsAvecRetry(() => docRef.update({ refreshToken }));
  await fsAvecRetry(() => codesRef.doc(email).delete());

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
  const value = isEmail ? emailOrPhone.trim().toLowerCase() : emailOrPhone.trim();
  const snap = await fsAvecRetry(() => usersRef.where(field, '==', value).limit(1).get());

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
  await fsAvecRetry(() => userDoc.ref.update({ refreshToken, updatedAt: new Date().toISOString() }));

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

  const userDoc = await fsAvecRetry(() => db.collection('users').doc(decoded.id).get());
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
  await fsAvecRetry(() => userDoc.ref.update({ refreshToken: tokens.refreshToken }));

  return ApiResponse.success(res, tokens, 'Token renouvelé');
};

exports.forgotPassword = async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();

  const snap = await fsAvecRetry(() => db.collection('users').where('email', '==', email).limit(1).get());

  if (snap.empty) {
    return ApiResponse.success(res, null, 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.');
  }

  const userDoc = snap.docs[0];
  const resetToken = uuidv4();
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await fsAvecRetry(() => userDoc.ref.update({
    resetPasswordToken: resetToken,
    resetPasswordExpiry: resetExpiry,
    updatedAt: new Date().toISOString(),
  }));

  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;

  try {
    await sendResetPassword(email, resetUrl);
  } catch (emailErr) {
    console.error('[EMAIL] Échec envoi reset password:', emailErr.message);
  }

  console.log(`[DEV] Reset URL: ${resetUrl}`);

  return ApiResponse.success(res, null, 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.');
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;

  const snap = await fsAvecRetry(() => db.collection('users').where('resetPasswordToken', '==', token).limit(1).get());

  if (snap.empty) {
    return ApiResponse.badRequest(res, 'Token invalide ou expiré');
  }

  const userDoc = snap.docs[0];
  const userData = userDoc.data();

  if (new Date(userData.resetPasswordExpiry) < new Date()) {
    return ApiResponse.badRequest(res, 'Token expiré. Veuillez faire une nouvelle demande.');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await fsAvecRetry(() => userDoc.ref.update({
    passwordHash,
    resetPasswordToken: null,
    resetPasswordExpiry: null,
    refreshToken: null,
    updatedAt: new Date().toISOString(),
  }));

  return ApiResponse.success(res, null, 'Mot de passe réinitialisé avec succès');
};

exports.getMe = async (req, res) => {
  return ApiResponse.success(res, formatUser(req.user.id, req.user));
};

exports.logout = async (req, res) => {
  await fsAvecRetry(() => db.collection('users').doc(req.user.id).update({
    refreshToken: null,
    updatedAt: new Date().toISOString(),
  }));
  return ApiResponse.success(res, null, 'Déconnexion réussie');
};
