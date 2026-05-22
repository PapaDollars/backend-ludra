const ApiResponse = require('../utils/ApiResponse');

const MAIN_OWNER_EMAIL = process.env.MAIN_OWNER_EMAIL || 'ludra.home@gmail.com';

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

// Vérifie qu'un admin a une permission précise
// Le compte propriétaire principal (MAIN_OWNER_EMAIL) a toutes les permissions
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) return ApiResponse.unauthorized(res, 'Authentification requise');
    if (req.user.role !== 'admin') return ApiResponse.forbidden(res, 'Accès réservé aux administrateurs');
    // Compte propriétaire principal → accès total
    if (req.user.email === MAIN_OWNER_EMAIL) return next();
    const perms = req.user.adminPermissions || [];
    if (!perms.includes(permission)) {
      return ApiResponse.forbidden(res, 'Permission insuffisante pour cette action');
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

module.exports = { requireRole, requireOwnerOrAdmin, requirePermission, MAIN_OWNER_EMAIL };
