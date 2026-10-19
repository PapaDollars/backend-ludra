const jwt = require('jsonwebtoken');
const { getUser } = require('../utils/userCache');
const ApiResponse = require('../utils/ApiResponse');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return ApiResponse.unauthorized(res, 'Token manquant');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUser(decoded.id); // cache mémoire 60 s (voir utils/userCache.js)

    if (!user) {
      return ApiResponse.unauthorized(res, 'Utilisateur introuvable');
    }

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
    req.user = await getUser(decoded.id);
  } catch {
    req.user = null;
  }

  next();
};

module.exports = { authenticate, optionalAuth };
