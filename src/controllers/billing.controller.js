const crypto = require('crypto');
const ApiResponse = require('../utils/ApiResponse');
const { AppError } = require('../utils/AppError');
const { PLAN_AUDIENCES } = require('../config/plans');
const { getPlans } = require('../services/settings.service');
const { getActiveSubscriptions } = require('../services/subscriptions.service');
const { createSubscriptionPayment, getPaymentForUser, handleProviderNotification } = require('../services/payments.service');

/** Plans, abonnements et paiements Mobile Money (M08, M12, M13). */

/** GET /plans?audience= — public → `Plan[]` actifs triés par rang. */
exports.getPlans = async (req, res) => {
  const { audience } = req.query;
  if (audience !== undefined && !PLAN_AUDIENCES.includes(audience)) {
    throw new AppError('Audience invalide (owner_agent | candidate | recruiter).', 400, 'VALIDATION_ERROR');
  }
  return ApiResponse.success(res, await getPlans(audience));
};

/** GET /subscriptions/me — auth → `Subscription[]` actifs. */
exports.getMySubscriptions = async (req, res) => ApiResponse.success(res, await getActiveSubscriptions(req.user.id));

/**
 * POST /payments/subscription { planCode, operator, payerPhone, idempotencyKey } + header Idempotency-Key
 * → `Payment` (`purpose: "subscription"`). Activation uniquement au statut `paid`.
 */
exports.subscribe = async (req, res) => {
  const body = req.body || {};
  const header = req.get('Idempotency-Key');
  if (header && body.idempotencyKey && header !== body.idempotencyKey) {
    throw new AppError("L'en-tête Idempotency-Key et idempotencyKey diffèrent.", 400, 'VALIDATION_ERROR');
  }
  const payment = await createSubscriptionPayment(req.user, {
    planCode: body.planCode,
    operator: body.operator,
    payerPhone: body.payerPhone,
    idempotencyKey: header || body.idempotencyKey,
  });
  return ApiResponse.success(res, payment, 'Paiement initié');
};

/** Comparaison à temps constant d'un secret (hash des deux côtés ⇒ même longueur). */
const sameSecret = (a, b) => {
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

/**
 * POST /payments/webhooks/orange/:secret — callback Orange (public, sans JWT).
 * Le format et l'authentification du callback Orange ne sont pas documentés dans les sources disponibles : le secret
 * dans l'URL réserve le point d'entrée à Orange, et le corps n'est jamais cru — le paiement est vérifié auprès d'Orange.
 * Réponse 200 même si la référence est inconnue (pas de nouvelle tentative inutile) ; 404 si le secret est faux.
 */
exports.orangeWebhook = async (req, res) => {
  const expected = process.env.ORANGE_WEBHOOK_SECRET;
  if (!expected || !sameSecret(req.params.secret, expected)) return res.status(404).json({ success: false, message: 'Service introuvable.' });
  const found = await handleProviderNotification('orange_cm', req.body);
  if (!found) console.warn('[paiements] Callback orange_cm sans paiement correspondant.');
  return res.status(200).json({ success: true });
};

/** GET /payments/:id — auth, propriétaire du paiement uniquement → `Payment`. */
exports.getPayment = async (req, res) => ApiResponse.success(res, await getPaymentForUser(req.user, req.params.id));
