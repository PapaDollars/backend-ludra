class ApiResponse {
  static success(res, data = null, message = 'Succès', statusCode = 200) {
    return res.status(statusCode).json({ success: true, message, data });
  }

  static created(res, data = null, message = 'Créé avec succès') {
    return res.status(201).json({ success: true, message, data });
  }

  static error(res, message = 'Une erreur est survenue', statusCode = 500, errors = null) {
    const body = { success: false, message };
    if (errors) body.errors = errors;
    return res.status(statusCode).json(body);
  }

  static notFound(res, message = 'Ressource introuvable') {
    return res.status(404).json({ success: false, message });
  }

  static unauthorized(res, message = 'Non autorisé') {
    return res.status(401).json({ success: false, message });
  }

  static forbidden(res, message = 'Accès refusé') {
    return res.status(403).json({ success: false, message });
  }

  static badRequest(res, message = 'Requête invalide', errors = null) {
    const body = { success: false, message };
    if (errors) body.errors = errors;
    return res.status(400).json(body);
  }

  static paginated(res, data, page, limit, total, message = 'Succès') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }
}

module.exports = ApiResponse;
