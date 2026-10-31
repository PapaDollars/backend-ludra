const ApiResponse = require('../utils/ApiResponse');
const { AppError } = require('../utils/AppError');
const { PLAN_AUDIENCES } = require('../config/plans');
const { getPlans } = require('../services/settings.service');
const { getActiveSubscriptions } = require('../services/subscriptions.service');
const { createSubscriptionPayment, getPaymentForUser } = require('../services/payments.service');

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

/** GET /payments/:id — auth, propriétaire du paiement uniquement → `Payment`. */
exports.getPayment = async (req, res) => ApiResponse.success(res, await getPaymentForUser(req.user, req.params.id));
