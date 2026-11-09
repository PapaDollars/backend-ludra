const crypto = require('crypto');
const { AppError } = require('../utils/AppError');

/**
 * Fournisseurs de paiement Mobile Money (MTN MoMo, Orange Money).
 *
 * Variable `PAYMENT_PROVIDER` :
 *  - `simulation` (défaut hors production) : reproduit le mock du front — paiement `paid` ~6 s après la
 *    demande ; un numéro payeur finissant par `0000` simule un échec. REFUSÉ en production.
 *  - `none` (défaut en production) : `503 PAYMENT_UNAVAILABLE`.
 *
 * Brancher un vrai fournisseur (agrégateur ou API opérateur) :
 *  1. ajouter un objet `{ name, request(payment, { payerPhone }) }` ci-dessous ; `request` déclenche le push USSD
 *     et renvoie `{ operatorReference }` ;
 *  2. exposer son webhook (signature vérifiée) qui appelle `payments.service.settlePayment(id, { status, ... })`.
 *  Le statut `paid` ne doit JAMAIS venir d'ailleurs que de ce webhook vérifié (contrat V2.1, étape 3).
 */
const SIMULATION_DELAY_MS = 6000;

const simulation = {
  name: 'simulation',
  async request(payment, { payerPhone }) {
    const fails = payerPhone.endsWith('0000');
    return {
      operatorReference: `SIM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      simulation: {
        resolveAt: new Date(Date.now() + SIMULATION_DELAY_MS).toISOString(),
        outcome: fails ? 'failed' : 'paid',
        ...(fails && { failureReason: 'Paiement refusé par l’opérateur (solde insuffisant ou délai dépassé).' }),
      },
    };
  },
};

const orangeCM = require('./providers/orangeCM');

/**
 * Fournisseurs réels : `PAYMENT_PROVIDER=orange_cm` n'active Orange que pour l'opérateur `orange_money`
 * (aucun fournisseur MTN n'est branché : `mtn_momo` ⇒ 503). Un fournisseur réel expose aussi
 * `getStatus(payment)` (vérification serveur → opérateur) et `extractReference(payload)` (callback).
 */
const LIVE = { orange_cm: { provider: orangeCM, operators: ['orange_money'] } };

const unavailable = () => new AppError('Le paiement Mobile Money est momentanément indisponible.', 503, 'PAYMENT_UNAVAILABLE');

const isProduction = () => process.env.NODE_ENV === 'production';

/** Fournisseur actif pour cet opérateur, ou erreur 503 si aucun n'est utilisable. */
const getProvider = (operator) => {
  const name = process.env.PAYMENT_PROVIDER || (isProduction() ? 'none' : 'simulation');
  if (name === 'simulation') {
    if (isProduction()) {
      console.error('[paiements] PAYMENT_PROVIDER=simulation refusé en production (droits accordés sans débit).');
      throw unavailable();
    }
    return simulation;
  }
  const live = LIVE[name];
  if (!live || !live.operators.includes(operator)) throw unavailable();
  const missing = live.provider.missingConfig();
  if (missing.length) {
    console.error(`[paiements] ${name} : variables d'environnement manquantes : ${missing.join(', ')}`);
    throw unavailable();
  }
  return live.provider;
};

/** Fournisseur réel par nom (règlement différé d'un paiement déjà créé), ou null. */
const getLiveProviderByName = (name) => (LIVE[name] && LIVE[name].provider.missingConfig().length === 0 ? LIVE[name].provider : null);

const LIVE_PROVIDER_NAMES = Object.keys(LIVE);

module.exports = { getProvider, getLiveProviderByName, LIVE_PROVIDER_NAMES, SIMULATION_DELAY_MS };
