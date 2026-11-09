const crypto = require('crypto');
const { db } = require('../config/firebase');
const { reconcilePendingBatch } = require('./payments.service');
const { LIVE_PROVIDER_NAMES } = require('./mobileMoney');

/**
 * Tâche planifiée : règle les paiements `pending` des fournisseurs réels dont le callback est perdu et que plus
 * personne ne suit (le suivi du front vérifie déjà à chaque lecture). Aussi un filet pour expirer ceux qui ont dépassé 15 min.
 *
 * - Activée seulement si `PAYMENT_PROVIDER` est un fournisseur réel (jamais en simulation).
 * - Intervalle : `PAYMENT_RECONCILE_INTERVAL_MS` (défaut 60 000, minimum 15 000).
 * - Bail Firestore (`locks/paymentReconciler`) : si plusieurs instances tournent, une seule exécute le lot.
 * - Coût Firestore (quota Spark) : environ 1 lecture + 1 écriture (bail) + 1 lecture (requête) par tick, soit ~4 300 opérations/jour à 60 s.
 * - Ne tourne que tant que le processus est éveillé : sur un hébergement qui endort l'instance, préférer un cron externe.
 */
const LEASE = () => db.collection('locks').doc('paymentReconciler');
const holder = crypto.randomBytes(6).toString('hex');

/** Prend le bail pour `ttlMs` si personne d'autre ne le détient. */
const acquireLease = (ttlMs) => db.runTransaction(async (tx) => {
  const snap = await tx.get(LEASE());
  const now = Date.now();
  if (snap.exists && Date.parse(snap.data().expiresAt) > now && snap.data().holder !== holder) return false;
  tx.set(LEASE(), { holder, expiresAt: new Date(now + ttlMs).toISOString() });
  return true;
});

/** Démarre la tâche ; renvoie `stop()` ou `null` si aucun fournisseur réel n'est actif. */
const startPaymentReconciler = () => {
  if (!LIVE_PROVIDER_NAMES.includes(process.env.PAYMENT_PROVIDER)) return null;
  const interval = Math.max(15000, Number(process.env.PAYMENT_RECONCILE_INTERVAL_MS) || 60000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (!(await acquireLease(Math.floor(interval * 0.8)))) return;
      const { checked, settled } = await reconcilePendingBatch();
      if (checked) console.log(`[paiements] Réconciliation : ${checked} vérifié(s), ${settled} réglé(s).`);
    } catch (err) {
      console.error('[paiements] Réconciliation planifiée échouée :', err.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, interval);
  timer.unref();
  console.log(`[paiements] Réconciliation planifiée toutes les ${Math.round(interval / 1000)} s (${process.env.PAYMENT_PROVIDER}).`);
  return () => clearInterval(timer);
};

module.exports = { startPaymentReconciler };
