const ApiResponse = require('../utils/ApiResponse');

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return ApiResponse.unauthorized(res, 'Authentification requise');
    }

    if (!roles.includes(req.user.role)) {
      return ApiResponse.forbidden(res, `Accès réservé aux : ${roles.join(', ')}`);
    }

    next();
  };
};

const requireOwnerOrAdmin = (getResourceOwnerId) => {
  return async (req, res, next) => {
    if (!req.user) {
      return ApiResponse.unauthorized(res, 'Authentification requise');
    }

    if (req.user.role === 'admin') {
      return next();
    }

    try {
      const ownerId = await getResourceOwnerId(req);

      if (ownerId !== req.user.id) {
        return ApiResponse.forbidden(res, 'Vous ne pouvez modifier que vos propres ressources');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { requireRole, requireOwnerOrAdmin };
