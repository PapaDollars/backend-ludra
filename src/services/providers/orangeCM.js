/**
 * Fournisseur Orange Money Cameroun — API « omcoreapis / mp » (paiement marchand, push USSD).
 *
 * ⚠ SOURCE : client communautaire `NdoleStudio/orangemoney-go` (lu le 2026-10-31). AUCUNE documentation officielle
 * Orange n'a pu être consultée : chemins, champs, statuts et format de l'enveloppe sont repris du code de ce client,
 * pas d'un contrat Orange. À CONFIRMER avec la documentation marchand / le contrat Orange avant la production.
 *
 * Recoupé (2026-10-31) avec un second client communautaire, `karibu-cap/orange_money_apis_js` : mêmes hôte
 * (`https://api-s1.orange.cm`), chemins, champs du corps de `pay`, en-têtes et Basic auth pour `/token`. Ce n'est pas une
 * source indépendante (ce dépôt renvoie lui-même à un projet antérieur) ni une confirmation d'Orange. Ses auteurs marquent
 * leur liste de statuts « Todo: verify api status » (PENDING, INITIATED, CANCELLED, FAILED, EXPIRED, SUCCESSFULL, SUCCESS).
 * Ce client désactive la vérification TLS (`rejectUnauthorized: false`) à cause d'un souci de certificat : NE JAMAIS le
 * reproduire ici ; si la chaîne de certificats d'Orange pose problème, ajouter l'autorité via `NODE_EXTRA_CA_CERTS`.
 *
 * Enchaînement (merchant_payment_service.go) :
 *   1. POST /token                                (Basic username:password, grant_type=client_credentials)
 *   2. POST /omcoreapis/1.0.2/mp/init             → { message, data: { payToken } }
 *   3. POST /omcoreapis/1.0.2/mp/pay              (corps : voir `payBody`)
 *   4. GET  /omcoreapis/1.0.2/mp/paymentstatus/{payToken} → { message, data: transaction }
 * Headers métier : Authorization: Bearer <token>, X-AUTH-TOKEN: <ORANGE_X_AUTH_TOKEN>.
 *
 * Non vérifié / non documenté par la source : format et authentification du callback `notifUrl`, liste complète des
 * statuts (le client ne connaît que PENDING, EXPIRED, SUCCESSFULL), format attendu des MSISDN, rôle exact du PIN
 * (`pin`) et de `channelUserMsisdn`, endpoint `push`. Le callback n'est donc JAMAIS cru : il sert de déclencheur,
 * le résultat vient toujours de `getStatus` (appel serveur → Orange).
 */

const REQUIRED_ENV = [
  'ORANGE_BASE_URL',
  'ORANGE_USERNAME',
  'ORANGE_PASSWORD',
  'ORANGE_X_AUTH_TOKEN',
  'ORANGE_CHANNEL_MSISDN',
  'ORANGE_PIN',
  'ORANGE_NOTIF_URL',
  'ORANGE_WEBHOOK_SECRET',
];

const TIMEOUT_MS = 10000;
const API = '/omcoreapis/1.0.2/mp';

const name = 'orange_cm';

/** Variables d'environnement manquantes (vide = fournisseur utilisable). */
const missingConfig = () => REQUIRED_ENV.filter((k) => !process.env[k]);

/** Erreur dont l'issue côté Orange est connue (rejet) ou inconnue (`ambiguous` : timeout / réseau). */
class OrangeError extends Error {
  constructor(message, { ambiguous = false, status } = {}) {
    super(message);
    this.name = 'OrangeError';
    this.ambiguous = ambiguous;
    this.status = status;
  }
}

const url = (path) => `${process.env.ORANGE_BASE_URL.replace(/\/+$/, '')}${path}`;

/** Appel HTTP + JSON. Ne journalise jamais les corps (PIN, jetons). */
const http = async (path, { method = 'GET', headers = {}, body } = {}) => {
  let res;
  try {
    res = await fetch(url(path), { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new OrangeError(`Orange injoignable (${err.name})`, { ambiguous: true });
  }
  let json = null;
  try {
    json = await res.json();
  } catch { /* corps non JSON */ }
  if (!res.ok) {
    throw new OrangeError(`Orange HTTP ${res.status}${json && json.message ? ` — ${String(json.message).slice(0, 120)}` : ''}`, {
      status: res.status,
      ambiguous: res.status >= 500, // 5xx : l'opération a pu aboutir côté Orange
    });
  }
  return json;
};

// ─── Jeton d'accès (mis en cache, renouvelé 100 s avant l'expiration comme le client Go) ───
let cached = { token: null, expiresAt: 0 };
let inflight = null;

const getAccessToken = async () => {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  if (inflight) return inflight;
  inflight = (async () => {
    const basic = Buffer.from(`${process.env.ORANGE_USERNAME}:${process.env.ORANGE_PASSWORD}`).toString('base64');
    const json = await http('/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    if (!json || typeof json.access_token !== 'string') throw new OrangeError('Réponse /token inattendue');
    cached = { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) - 100) * 1000 };
    return cached.token;
  })().finally(() => { inflight = null; });
  return inflight;
};

const resetTokenCache = () => { cached = { token: null, expiresAt: 0 }; };

const call = async (path, { method = 'GET', payload } = {}) => {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-AUTH-TOKEN': process.env.ORANGE_X_AUTH_TOKEN,
    Accept: 'application/json',
    ...(payload !== undefined && { 'Content-Type': 'application/json' }),
  };
  try {
    return await http(path, { method, headers, body: payload !== undefined ? JSON.stringify(payload) : undefined });
  } catch (err) {
    if (err.status === 401) resetTokenCache(); // jeton révoqué : le prochain appel en redemande un
    throw err;
  }
};

/** Format MSISDN envoyé à Orange : NON VÉRIFIÉ. `ORANGE_MSISDN_PREFIX` (ex. indicatif pays) s'ajoute devant 6XXXXXXXX. */
const msisdn = (local) => `${process.env.ORANGE_MSISDN_PREFIX || ''}${local}`;

/**
 * Initie le paiement : init → pay. Retourne `{ operatorReference }` (= payToken).
 * Un rejet explicite d'Orange lève une erreur (paiement `failed`, rien de débité). Un résultat ambigu à l'étape `pay`
 * (timeout, 5xx) laisse le paiement `pending` : le statut est ensuite tranché par `getStatus`.
 */
const request = async (payment, { payerPhone }) => {
  const init = await call(`${API}/init`, { method: 'POST' });
  const payToken = init && init.data && init.data.payToken;
  if (typeof payToken !== 'string' || !payToken) throw new OrangeError('Réponse /init sans payToken');

  const payBody = {
    subscriberMsisdn: msisdn(payerPhone),
    channelUserMsisdn: msisdn(process.env.ORANGE_CHANNEL_MSISDN),
    amount: String(payment.amount),
    description: payment.label || 'Paiement Ludra',
    orderId: payment.id,
    pin: process.env.ORANGE_PIN,
    payToken,
    notifUrl: process.env.ORANGE_NOTIF_URL,
  };
  try {
    await call(`${API}/pay`, { method: 'POST', payload: payBody });
  } catch (err) {
    if (!(err instanceof OrangeError) || !err.ambiguous) throw err;
    console.error(`[orange_cm] Issue de /pay incertaine pour ${payment.id} (${err.message}) — paiement laissé pending.`);
  }
  return { operatorReference: payToken };
};

/**
 * Interroge Orange et traduit le statut. Seul `SUCCESSFULL` (orthographe du client Go) accompagné de
 * `confirmtxnstatus` et `confirmtxnmessage` non nuls vaut `paid`, et seulement si le montant correspond.
 * Tout statut inconnu reste `pending` (jamais `paid` par défaut) : le délai de 15 min finit par l'expirer.
 *
 * @returns {Promise<{ status: 'paid' | 'expired' | 'pending' }>}
 */
const getStatus = async (payment) => {
  if (!payment.operatorReference) throw new OrangeError('payToken absent');
  const json = await call(`${API}/paymentstatus/${encodeURIComponent(payment.operatorReference)}`);
  const tx = json && json.data;
  if (!tx || typeof tx !== 'object') throw new OrangeError('Réponse /paymentstatus inattendue');

  if (tx.status === 'EXPIRED') return { status: 'expired' };
  if (tx.status === 'PENDING') return { status: 'pending' };
  if (tx.status === 'SUCCESSFULL' && tx.confirmtxnstatus != null && tx.confirmtxnmessage != null) {
    if (Number(tx.amount) !== Number(payment.amount)) {
      console.error(`[orange_cm] Montant incohérent pour ${payment.id} : attendu ${payment.amount}, reçu ${tx.amount} — non réglé.`);
      return { status: 'pending' };
    }
    return { status: 'paid' };
  }
  console.warn(`[orange_cm] Statut non reconnu pour ${payment.id} : « ${String(tx.status).slice(0, 40)} » — laissé pending.`);
  return { status: 'pending' };
};

/** payToken contenu dans le callback. Champ `payToken` repris de la struct Go (non confirmé par Orange). */
const extractReference = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const ref = payload.payToken || (payload.data && payload.data.payToken);
  return typeof ref === 'string' && ref.length > 0 && ref.length <= 200 ? ref : null;
};

module.exports = { name, request, getStatus, extractReference, missingConfig, OrangeError, _resetTokenCache: resetTokenCache };
