const errorHandler = (err, req, res, next) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expiré' });
  }

  if (err.code === 'auth/email-already-exists') {
    return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'Fichier trop volumineux (max 5 MB)' });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Erreur interne du serveur';

  res.status(statusCode).json({ success: false, message });
};

module.exports = errorHandler;
