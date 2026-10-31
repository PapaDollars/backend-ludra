const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Toujours logger le détail complet côté serveur
  console.error(`[ERROR] ${req.method} ${req.originalUrl} → ${statusCode} | ${err.message}`);
  if (statusCode >= 500 && err.name !== 'AppError') console.error(err.stack); // AppError : erreur métier volontaire

  // ── Erreurs fonctionnelles connues (message utile pour le client) ──
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Session invalide. Veuillez vous reconnecter.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Session expirée. Veuillez vous reconnecter.' });
  }
  if (err.code === 'auth/email-already-exists') {
    return res.status(409).json({ success: false, message: 'Cette adresse email est déjà utilisée.' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'Fichier trop volumineux (max 5 MB).' });
  }

  // ── Erreurs 4xx, et erreurs métier volontaires (AppError 501/503) : message contrôlé par le code ──
  if ((statusCode >= 400 && statusCode < 500) || err.name === 'AppError') {
    return res.status(statusCode).json({
      success: false,
      message: err.message || 'Requête invalide.',
      // Code métier et erreurs de champ (utils/AppError.js) — lus par le front (ApiError.code / .errors)
      ...(typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) && { code: err.code }),
      ...(Array.isArray(err.errors) && { errors: err.errors }),
    });
  }

  // ── Erreurs 5xx : message générique, on ne divulgue rien ──
  res.status(500).json({ success: false, message: 'Une erreur est survenue. Veuillez réessayer plus tard.' });
};

module.exports = errorHandler;
