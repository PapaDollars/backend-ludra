const { db } = require('../config/firebase');

/**
 * Cache mémoire des documents `users` (quota Firestore Spark : 50 000 lectures / jour).
 *
 * - `getUser(id)` : utilisé par le middleware d'authentification. Sans cache, CHAQUE requête
 *   authentifiée coûte 1 lecture ; avec, au plus 1 lecture par utilisateur et par minute.
 * - `getAllUsers()` : liste complète pour le back-office (recherche plein texte impossible côté
 *   Firestore) ; relue au plus toutes les 2 minutes au lieu de chaque page / recherche.
 *
 * Toute écriture sur un document `users` DOIT appeler `invalidateUser(id)` (même processus) pour
 * que les changements (suspension, rôle, profil) soient visibles immédiatement.
 * Valable pour une seule instance (Render sans scaling) ; avec plusieurs instances, réduire les TTL.
 */
const USER_TTL_MS = 60 * 1000;
const LIST_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 5000;

const users = new Map(); // id → { data, expires }
let list = null; // { docs: [{ id, data }], expires }

const clone = (data) => (data ? JSON.parse(JSON.stringify(data)) : data);

/** Document utilisateur `{ id, ...data }` ou `null` s'il n'existe pas. */
const getUser = async (id) => {
  const hit = users.get(id);
  if (hit && hit.expires > Date.now()) return clone(hit.data);

  const doc = await db.collection('users').doc(id).get();
  const data = doc.exists ? { id: doc.id, ...doc.data() } : null;
  if (users.size >= MAX_ENTRIES) users.delete(users.keys().next().value);
  users.set(id, { data, expires: Date.now() + USER_TTL_MS });
  return clone(data);
};

/** Tous les documents `users` (pour le back-office). */
const getAllUsers = async () => {
  if (list && list.expires > Date.now()) return clone(list.docs);
  const snap = await db.collection('users').get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  list = { docs, expires: Date.now() + LIST_TTL_MS };
  return clone(docs);
};

/**
 * À appeler après toute écriture sur `users/{id}`.
 * `list: false` quand l'écriture ne touche aucun champ affiché dans le back-office
 * (refreshToken, updatedAt, jeton de réinitialisation…).
 */
const invalidateUser = (id, { list: clearList = true } = {}) => {
  if (id) users.delete(id);
  if (clearList) list = null;
};

/** Vide tout (tests). */
const clearUserCache = () => { users.clear(); list = null; };

module.exports = { getUser, getAllUsers, invalidateUser, clearUserCache };
