/**
 * Erreur métier levée dans un contrôleur ou un service (gérée par middleware/errorHandler.js).
 * `code` et `errors` sont renvoyés au front (contrat V2.1 : `{ success: false, message, code?, errors? }`).
 */
class AppError extends Error {
  /**
   * @param {string} message  message lisible par l'utilisateur
   * @param {number} statusCode
   * @param {string} [code]   code métier (NOT_FOUND, PLAN_REQUIRED, VALIDATION_ERROR…)
   * @param {{ field: string, message: string }[]} [errors]
   */
  constructor(message, statusCode = 400, code, errors) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    if (code) this.code = code;
    if (errors && errors.length) this.errors = errors;
  }
}

const notFound = (message = 'Ressource introuvable') => new AppError(message, 404, 'NOT_FOUND');

const validationError = (errors, message = 'Certains champs sont à corriger.') =>
  new AppError(message, 422, 'VALIDATION_ERROR', errors);

module.exports = { AppError, notFound, validationError };
