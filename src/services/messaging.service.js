const crypto = require('crypto');
const { admin, db } = require('../config/firebase');
const { AppError, notFound, validationError } = require('../utils/AppError');
const { moderateMessage, normalize } = require('../utils/text');
const { encodeCursor, decodeCursor } = require('../utils/pagination');
const { createNotification } = require('../utils/notifications');
const { getUser } = require('../utils/userCache');
const { getCandidate } = require('./candidates.service');
const { canContactCandidates, getRecruiterPlan } = require('./recruiter.service');

/**
 * Messagerie interne (module 05), collection `conversations` + sous-collection `messages`.
 *
 * - Une conversation par paire d'utilisateurs et par objet : id déterministe `cv_<hash>` (la paire est triée, donc
 *   que A ou B ouvre en premier, c'est la même conversation). `create()` ⇒ ouverture idempotente.
 * - Les champs affichés des deux participants sont recopiés dans le document (règle de coût n° 4, pas de N+1).
 * - Droit `contact` (contrat étape 8) : ouvrir une conversation VERS un candidat exige un forfait recruteur avec le
 *   droit `contact` (`403 PLAN_REQUIRED`), sauf si la conversation existe déjà (donc initiée par le candidat, ou ouverte
 *   avant). Tant que le recruteur est celui qui a ouvert (`gatedUserId`), le droit est revérifié à CHAQUE envoi : un
 *   forfait expiré ne permet plus d'écrire.
 * - Aucune coordonnée ni lien dans un message : remplacés côté serveur (`moderation`).
 * - Non implémenté : images (le contrôleur répond 501), présence en ligne, compteur `unreadMessages` de /me/counters.
 */
const COLLECTION = 'conversations';
const ALREADY_EXISTS = 6; // code gRPC Firestore
const MAX_TEXT = 2000;
const PAGE_SIZE = 20;
const MESSAGES_PAGE = 30;
const MESSAGES_MAX = 50;
const SEARCH_WINDOW = 100;

const col = () => db.collection(COLLECTION);
const idRe = /^cv_[a-f0-9]{24}$/;
const messageIdRe = /^\d{13}-[a-f0-9]{6}$/;

const conversationId = (a, b, itemId) =>
  `cv_${crypto.createHash('sha256').update(`${[a, b].sort().join(':')}:${itemId || ''}`).digest('hex').slice(0, 24)}`;

// Strictement croissant dans le processus : deux messages envoyés dans la même milliseconde gardent leur ordre
let lastMessageMs = 0;
const messageId = () => {
  lastMessageMs = Math.max(Date.now(), lastMessageMs + 1);
  return `${String(lastMessageMs).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
};

const isMissingIndex = (err) => err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(err.message || ''));

// ─── FORMES ──────────────────────────────────────────────────────────────────

/** Document → `Conversation` pour l'utilisateur `me` (jamais de téléphone ni d'e-mail). */
const toConversation = (id, d, me) => {
  const other = d.participants.find((p) => p !== me);
  const blockedBy = d.blockedBy || [];
  return {
    id,
    participant: d.people[other],
    context: d.context || null,
    lastMessage: d.lastMessage
      ? { text: d.lastMessage.text, fromMe: d.lastMessage.senderId === me, createdAt: d.lastMessage.createdAt }
      : null,
    unreadCount: (d.unread && d.unread[me]) || 0,
    updatedAt: d.updatedAt,
    participantOnline: false, // pas de présence en temps réel
    participantLastReadAt: (d.lastReadAt && d.lastReadAt[other]) || null,
    blockedByMe: blockedBy.includes(me),
    blockedMe: blockedBy.includes(other),
  };
};

const toMessage = (id, convId, d, me) => ({
  id,
  conversationId: convId,
  kind: d.kind,
  fromMe: d.senderId === me,
  ...(d.text && { text: d.text }),
  ...(d.image && { image: d.image }),
  createdAt: d.createdAt,
  ...(d.moderation && d.moderation.length && { moderation: d.moderation }),
});

/** Chargement d'une conversation réservée à ses participants (404 sinon, sans révéler son existence). */
const loadForUser = async (user, id) => {
  if (typeof id !== 'string' || !idRe.test(id)) throw notFound('Conversation introuvable');
  const snap = await col().doc(id).get();
  if (!snap.exists || !snap.data().participants.includes(user.id)) throw notFound('Conversation introuvable');
  return { ref: snap.ref, data: snap.data() };
};

// ─── OUVERTURE ───────────────────────────────────────────────────────────────

const publisherOf = async (user, candidate) => {
  let kind = 'user';
  if (candidate && candidate.status === 'active') kind = 'candidate';
  else if ((await getRecruiterPlan(user.id)).planCode) kind = 'recruiter';
  return {
    id: user.id,
    name: user.name || 'Utilisateur',
    avatar: user.avatar || null,
    kind,
    verified: user.kycStatus === 'verifie',
    ...(user.city && { city: user.city }),
  };
};

/**
 * `POST /conversations/open { recipientId, itemId? }` : trouve ou crée la conversation.
 * `itemId` = profil candidat (seul objet géré aujourd'hui ; annonces et services : à brancher avec leurs modules).
 */
const openConversation = async (user, { recipientId, itemId } = {}) => {
  const errors = [];
  if (typeof recipientId !== 'string' || !recipientId || recipientId.includes('/')) errors.push({ field: 'recipientId', message: 'Destinataire invalide.' });
  if (itemId !== undefined && itemId !== null && (typeof itemId !== 'string' || !itemId || itemId.includes('/'))) errors.push({ field: 'itemId', message: 'Objet invalide.' });
  if (errors.length) throw validationError(errors);
  if (recipientId === user.id) throw new AppError('Vous ne pouvez pas vous écrire à vous-même.', 400, 'SELF_CONVERSATION');

  const recipient = await getUser(recipientId);
  if (!recipient || recipient.isActive === false) throw notFound('Destinataire introuvable');

  const item = itemId || null;
  let context = null;
  if (item) {
    const profile = await getCandidate(item);
    // Un profil candidat appartient à l'un des deux participants (le candidat peut écrire en citant son propre profil)
    if (!profile || profile.status !== 'active' || ![recipientId, user.id].includes(profile.userId)) throw notFound('Objet introuvable');
    context = {
      universe: 'personnel',
      itemId: profile.id,
      title: profile.title,
      ...(profile.media && profile.media[0] && { thumbnail: profile.media[0].url }),
    };
  }

  const id = conversationId(user.id, recipientId, item);
  const ref = col().doc(id);
  const existing = await ref.get();
  if (existing.exists) return toConversation(id, existing.data(), user.id);

  // Nouvelle conversation vers un candidat actif ⇒ droit `contact` du forfait recruteur
  const recipientProfile = await getCandidate(recipientId);
  const toCandidate = Boolean(recipientProfile && recipientProfile.status === 'active');
  if (toCandidate && !(await canContactCandidates(user.id))) {
    throw new AppError('Contacter un candidat est réservé aux forfaits recruteurs.', 403, 'PLAN_REQUIRED');
  }

  const now = new Date().toISOString();
  const data = {
    participants: [user.id, recipientId].sort(),
    people: {
      [user.id]: await publisherOf(user, await getCandidate(user.id)),
      [recipientId]: await publisherOf(recipient, recipientProfile),
    },
    initiatorId: user.id,
    gatedUserId: toCandidate ? user.id : null,
    context,
    hasMessages: false,
    lastMessage: null,
    unread: { [user.id]: 0, [recipientId]: 0 },
    lastReadAt: { [user.id]: null, [recipientId]: null },
    blockedBy: [],
    createdAt: now,
    updatedAt: now,
  };
  try {
    await ref.create(data);
  } catch (err) {
    if (err.code !== ALREADY_EXISTS) throw err;
    return toConversation(id, (await ref.get()).data(), user.id);
  }
  return toConversation(id, data, user.id);
};

// ─── LECTURE ─────────────────────────────────────────────────────────────────

/** `GET /conversations?q=&cursor=` : mes conversations non vides, la plus récente d'abord. */
const listConversations = async (user, { q, cursor } = {}) => {
  const search = typeof q === 'string' ? normalize(q) : '';
  const size = search ? SEARCH_WINDOW : PAGE_SIZE;
  // Curseur = « updatedAt|id » (l'id départage deux conversations modifiées dans la même milliseconde)
  const [afterAt, afterId] = !search && cursor ? Buffer.from(String(cursor), 'base64url').toString().split('|') : [];
  const after = afterAt && afterId ? { at: afterAt, id: afterId } : null;

  const base = col().where('participants', 'array-contains', user.id).where('hasMessages', '==', true);
  let docs;
  try {
    let query = base.orderBy('updatedAt', 'desc').orderBy(admin.firestore.FieldPath.documentId(), 'desc');
    if (after) query = query.startAfter(after.at, after.id);
    docs = (await query.limit(size + 1).get()).docs;
  } catch (err) {
    if (!isMissingIndex(err)) throw err;
    console.warn('[conversations] Index composite manquant — tri en mémoire :', err.message);
    docs = (await base.get()).docs
      .sort((a, b) => String(b.data().updatedAt).localeCompare(String(a.data().updatedAt)) || b.id.localeCompare(a.id))
      .filter((d) => !after || String(d.data().updatedAt) < after.at || (String(d.data().updatedAt) === after.at && d.id < after.id))
      .slice(0, size + 1);
  }

  const more = docs.length > size;
  let items = docs.slice(0, size).map((d) => toConversation(d.id, d.data(), user.id));
  if (search) {
    items = items.filter((c) => normalize(c.participant.name).includes(search) || (c.context && normalize(c.context.title).includes(search)));
  }
  const last = items[items.length - 1];
  const nextCursor = !search && more ? Buffer.from(`${last.updatedAt}|${last.id}`).toString('base64url') : null;
  return { items, nextCursor };
};

const getConversation = async (user, id) => {
  const { data } = await loadForUser(user, id);
  return toConversation(id, data, user.id);
};

/**
 * `GET /conversations/:id/messages?before=&after=&limit=` : ordre chronologique.
 * `before` (ou rien) : historique, `nextCursor` = id du plus ancien renvoyé s'il en reste avant. `after` : polling.
 */
const listMessages = async (user, id, { before, after, limit } = {}) => {
  await loadForUser(user, id);
  for (const [field, v] of [['before', before], ['after', after]]) {
    if (v !== undefined && !messageIdRe.test(String(v))) throw validationError([{ field, message: 'Curseur invalide.' }]);
  }
  const msgs = col().doc(id).collection('messages');
  const docId = admin.firestore.FieldPath.documentId();

  if (after) {
    const snap = await msgs.where(docId, '>', after).orderBy(docId).limit(100).get();
    return { items: snap.docs.map((d) => toMessage(d.id, id, d.data(), user.id)), nextCursor: null };
  }
  const size = Math.min(MESSAGES_MAX, Math.max(1, Number(limit) || MESSAGES_PAGE));
  let query = msgs.orderBy(docId, 'desc');
  if (before) query = query.where(docId, '<', before);
  const snap = await query.limit(size + 1).get();
  const more = snap.docs.length > size;
  const items = snap.docs.slice(0, size).reverse().map((d) => toMessage(d.id, id, d.data(), user.id));
  return { items, nextCursor: more ? items[0].id : null };
};

// ─── ÉCRITURE ────────────────────────────────────────────────────────────────

/** `POST /conversations/:id/messages` (texte). Renvoie le message tel que modéré. */
const sendMessage = async (user, id, { text } = {}) => {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) throw validationError([{ field: 'text', message: 'Message vide.' }]);
  if (raw.length > MAX_TEXT) throw validationError([{ field: 'text', message: `Message trop long (${MAX_TEXT} caractères maximum).` }]);

  const { ref, data: pre } = await loadForUser(user, id);
  if ((pre.blockedBy || []).length) throw new AppError('Vous ne pouvez plus écrire dans cette conversation.', 403, 'BLOCKED');
  // Le recruteur qui a ouvert vers un candidat doit encore avoir le droit `contact` (forfait non expiré)
  if (pre.gatedUserId === user.id && !(await canContactCandidates(user.id))) {
    throw new AppError('Votre forfait recruteur n’est plus actif : le contact est suspendu.', 403, 'PLAN_REQUIRED');
  }

  const { text: clean, moderation } = moderateMessage(raw);
  const mid = messageId();
  const now = new Date().toISOString();
  const other = pre.participants.find((p) => p !== user.id);
  const message = { kind: 'text', senderId: user.id, text: clean, createdAt: now, ...(moderation.length && { moderation }) };

  const wasUnread = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if ((d.blockedBy || []).length) throw new AppError('Vous ne pouvez plus écrire dans cette conversation.', 403, 'BLOCKED');
    tx.set(ref.collection('messages').doc(mid), message);
    tx.update(ref, {
      hasMessages: true,
      lastMessage: { text: clean, senderId: user.id, createdAt: now },
      updatedAt: now,
      [`unread.${other}`]: admin.firestore.FieldValue.increment(1),
      [`unread.${user.id}`]: 0,
      [`lastReadAt.${user.id}`]: now,
    });
    return ((d.unread && d.unread[other]) || 0) > 0;
  });

  // Une seule notification tant que le destinataire n'a pas lu (pas une par message)
  if (!wasUnread) {
    await createNotification(other, {
      kind: 'message', title: `Nouveau message de ${user.name || 'un utilisateur'}`,
      body: 'Ouvrez la conversation pour le lire.', href: `/messages/${id}`,
    }).catch((err) => console.error('[messagerie] Notification non envoyée :', err.message));
  }
  return toMessage(mid, id, message, user.id);
};

/** `POST /conversations/:id/read` : remet mon compteur à 0 (sans écriture si rien à marquer). */
const markRead = async (user, id) => {
  const { ref, data } = await loadForUser(user, id);
  const unread = (data.unread && data.unread[user.id]) || 0;
  if (unread === 0 && data.lastReadAt && data.lastReadAt[user.id]) return;
  await ref.update({ [`unread.${user.id}`]: 0, [`lastReadAt.${user.id}`]: new Date().toISOString() });
};

/** `POST|DELETE /conversations/:id/block` : bloquer / débloquer l'autre participant. */
const setBlocked = async (user, id, blocked) => {
  const { ref, data } = await loadForUser(user, id);
  const blockedBy = new Set(data.blockedBy || []);
  if (blocked) blockedBy.add(user.id); else blockedBy.delete(user.id);
  const next = [...blockedBy];
  await ref.update({ blockedBy: next });
  return toConversation(id, { ...data, blockedBy: next }, user.id);
};

module.exports = {
  openConversation, listConversations, getConversation, listMessages, sendMessage, markRead, setBlocked,
  conversationId, MAX_TEXT,
};
