const jwt = require('jsonwebtoken');
const { db } = require('../config/firebase');
const ApiResponse = require('../utils/ApiResponse');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return ApiResponse.unauthorized(res, 'Token manquant');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userDoc = await db.collection('users').doc(decoded.id).get();

    if (!userDoc.exists) {
      return ApiResponse.unauthorized(res, 'Utilisateur introuvable');
    }

    const user = { id: userDoc.id, ...userDoc.data() };

    if (!user.isActive) {
      return res.status(403).json({ success: false, code: 'ACCOUNT_DISABLED', message: 'Votre compte a été restreint.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return ApiResponse.unauthorized(res, 'Token invalide ou expiré');
  }
};

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userDoc = await db.collection('users').doc(decoded.id).get();

    if (userDoc.exists) {
      req.user = { id: userDoc.id, ...userDoc.data() };
    } else {
      req.user = null;
    }
  } catch {
    req.user = null;
  }

  next();
};

module.exports = { authenticate, optionalAuth };
