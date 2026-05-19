const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Toujours logger le détail complet côté serveur
  console.error(`[ERROR] ${req.method} ${req.originalUrl} → ${statusCode} | ${err.message}`);
  if (statusCode >= 500) console.error(err.stack);

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

  // ── Erreurs 4xx : message de l'erreur (contrôlé par le code métier) ──
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({ success: false, message: err.message || 'Requête invalide.' });
  }

  // ── Erreurs 5xx : message générique, on ne divulgue rien ──
  res.status(500).json({ success: false, message: 'Une erreur est survenue. Veuillez réessayer plus tard.' });
};

module.exports = errorHandler;
