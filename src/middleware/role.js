const ApiResponse = require('../utils/ApiResponse');

const MAIN_OWNER_EMAIL = process.env.MAIN_OWNER_EMAIL || 'ludra.home@gmail.com';

// 'proprietaire' est le rôle unique du compte principal — accès total à tout
const isPrivileged = (role) => role === 'admin' || role === 'proprietaire';

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) return ApiResponse.unauthorized(res, 'Authentification requise');

    // 'proprietaire' passe toujours, quel que soit le rôle demandé
    if (req.user.role === 'proprietaire') return next();

    if (!roles.includes(req.user.role)) {
      return ApiResponse.forbidden(res, `Accès réservé aux : ${roles.join(', ')}`);
    }
    next();
  };
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) return ApiResponse.unauthorized(res, 'Authentification requise');
    // 'proprietaire' → accès total sans vérification de permission
    if (req.user.role === 'proprietaire') return next();
    if (req.user.role !== 'admin') return ApiResponse.forbidden(res, 'Accès réservé aux administrateurs');
    const perms = req.user.adminPermissions || [];
    if (!perms.includes(permission)) {
      return ApiResponse.forbidden(res, 'Permission insuffisante pour cette action');
    }
    next();
  };
};

const requireOwnerOrAdmin = (getResourceOwnerId) => {
  return async (req, res, next) => {
    if (!req.user) return ApiResponse.unauthorized(res, 'Authentification requise');
    if (isPrivileged(req.user.role)) return next();
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

module.exports = { requireRole, requireOwnerOrAdmin, requirePermission, isPrivileged, MAIN_OWNER_EMAIL };
