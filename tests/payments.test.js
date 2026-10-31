const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeFirebase } = require('./helpers/fakeFirestore');

const db = installFakeFirebase();
process.env.NODE_ENV = 'test';
process.env.PAYMENT_PROVIDER = 'simulation';
Object.assign(process.env, {
  ORANGE_BASE_URL: 'https://orange.test', ORANGE_USERNAME: 'u', ORANGE_PASSWORD: 'p', ORANGE_X_AUTH_TOKEN: 'xat',
  ORANGE_CHANNEL_MSISDN: '690000001', ORANGE_PIN: '1234', ORANGE_NOTIF_URL: 'https://api.test/cb', ORANGE_WEBHOOK_SECRET: 's',
});

const payments = require('../src/services/payments.service');
const { getActiveSubscriptions } = require('../src/services/subscriptions.service');
const orange = require('../src/services/providers/orangeCM');

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
/** Utilisateur unique par appel (les caches mémoire des services sont par id) + document `users`. */
const mkUser = (extra = {}) => {
  n += 1;
  const user = { id: `user${n}`, name: `Utilisateur ${n}`, email: `u${n}@test.cm`, isActive: true, ...extra };
  db.seed(`users/${user.id}`, user);
  return user;
};
const mkCandidate = (user, extra = {}) => db.seed(`candidates/${user.id}`, {
  userId: user.id, status: 'active', title: 'Chauffeur', job: 'Chauffeur', jobCode: 'driver', city: 'Douala', experienceYears: 3,
  availability: 'immediate', publisher: { id: user.id, name: user.name, avatar: null, kind: 'candidate', verified: false },
  plan: 'gratuit', planExpiresAt: null, media: [], publishedAt: new Date().toISOString(), ...extra,
});
let k = 0;
const input = (planCode, extra = {}) => { k += 1; return { planCode, operator: 'orange_money', payerPhone: '677112233', idempotencyKey: `idem-key-${k}-abcdef`, ...extra }; };
const docsOf = (prefix) => [...db.store.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'));
const notificationsOf = (userId) => docsOf('notifications/').map((p) => db.peek(p)).filter((x) => x.userId === userId);
const ageCreatedAt = (id, ms) => { const d = db.peek(`payments/${id}`); db.seed(`payments/${id}`, { ...d, createdAt: new Date(Date.now() - ms).toISOString() }); };
const rejectsWith = (p, status, code) => assert.rejects(p, (e) => e.statusCode === status && (code === undefined || e.code === code));

test.beforeEach(() => { db.reset(); orange._resetTokenCache(); process.env.PAYMENT_PROVIDER = 'simulation'; });

// ─── Création et idempotence ─────────────────────────────────────────────────

test('même clé d’idempotence ⇒ même paiement, un seul document, numéro payeur jamais renvoyé', async () => {
  const u = mkUser();
  const body = input('rec_forme');
  const a = await payments.createSubscriptionPayment(u, body);
  const b = await payments.createSubscriptionPayment(u, body);
  assert.equal(a.id, b.id);
  assert.equal(docsOf('payments/').length, 1);
  assert.equal(a.status, 'pending');
  assert.equal(a.amount, 8000);
  assert.ok(!JSON.stringify(a).includes('677112233'), 'le numéro du payeur ne doit pas sortir');
});

test('même clé pour un autre plan ⇒ 409 IDEMPOTENCY_CONFLICT', async () => {
  const u = mkUser();
  const body = input('rec_forme');
  await payments.createSubscriptionPayment(u, body);
  await rejectsWith(payments.createSubscriptionPayment(u, { ...body, planCode: 'rec_premium' }), 409, 'IDEMPOTENCY_CONFLICT');
});

test('la même clé d’un autre utilisateur donne un autre paiement', async () => {
  const body = input('rec_forme');
  const a = await payments.createSubscriptionPayment(mkUser(), body);
  const b = await payments.createSubscriptionPayment(mkUser(), body);
  assert.notEqual(a.id, b.id);
});

test('validation : téléphone, opérateur, clé ; plan gratuit 422 FREE_PLAN ; plan inconnu 404', async () => {
  const u = mkUser();
  await rejectsWith(payments.createSubscriptionPayment(u, input('rec_forme', { payerPhone: '12345' })), 422);
  await rejectsWith(payments.createSubscriptionPayment(u, input('rec_forme', { operator: 'paypal' })), 422);
  await rejectsWith(payments.createSubscriptionPayment(u, input('rec_forme', { idempotencyKey: 'x' })), 422);
  await rejectsWith(payments.createSubscriptionPayment(u, input('cand_gratuit')), 422, 'FREE_PLAN');
  await rejectsWith(payments.createSubscriptionPayment(u, input('plan_inexistant')), 404);
  assert.equal(docsOf('payments/').length, 0, 'aucun paiement créé sur une entrée invalide');
});

test('production : la simulation est refusée (503) et aucun paiement n’est écrit', async () => {
  const u = mkUser();
  process.env.NODE_ENV = 'production';
  try {
    await rejectsWith(payments.createSubscriptionPayment(u, input('rec_forme')), 503, 'PAYMENT_UNAVAILABLE');
    process.env.PAYMENT_PROVIDER = 'none';
    await rejectsWith(payments.createSubscriptionPayment(u, input('rec_forme')), 503, 'PAYMENT_UNAVAILABLE');
  } finally { process.env.NODE_ENV = 'test'; }
  assert.equal(docsOf('payments/').length, 0);
});

// ─── Règlement : abonnement, reçu, garde-fous ────────────────────────────────

test('paid ⇒ abonnement actif 30 jours, profil candidat mis à jour, reçu REC-AAAA-000001, notification', async () => {
  const u = mkUser();
  mkCandidate(u);
  const created = await payments.createSubscriptionPayment(u, input('cand_premium'));
  const settled = await payments.settlePayment(created.id, { status: 'paid' });

  const sub = db.peek(`subscriptions/${u.id}_candidate`);
  assert.equal(sub.planCode, 'cand_premium');
  assert.equal(sub.status, 'active');
  assert.equal(sub.lastPaymentId, created.id);
  assert.ok(Math.abs(Date.parse(sub.expiresAt) - (Date.now() + 30 * DAY)) < 60 * 1000);
  const profile = db.peek(`candidates/${u.id}`);
  assert.equal(profile.plan, 'premium');
  assert.equal(profile.planExpiresAt, sub.expiresAt);
  assert.match(settled.receiptNumber, new RegExp(`^REC-${new Date().getUTCFullYear()}-000001$`));
  assert.equal((await getActiveSubscriptions(u.id))[0].planCode, 'cand_premium');
  assert.equal(notificationsOf(u.id).length, 1);
  assert.equal(notificationsOf(u.id)[0].kind, 'subscription');
});

test('numéros de reçu séquentiels ; un second règlement ne change ni reçu ni notification', async () => {
  const u1 = mkUser();
  const u2 = mkUser();
  const p1 = await payments.createSubscriptionPayment(u1, input('rec_essentiel'));
  const p2 = await payments.createSubscriptionPayment(u2, input('rec_essentiel'));
  const a = await payments.settlePayment(p1.id, { status: 'paid' });
  const b = await payments.settlePayment(p2.id, { status: 'paid' });
  assert.ok(a.receiptNumber.endsWith('-000001'));
  assert.ok(b.receiptNumber.endsWith('-000002'));

  const again = await payments.settlePayment(p1.id, { status: 'paid' });
  assert.equal(again.receiptNumber, a.receiptNumber);
  assert.equal(db.peek(`counters/receipts_${new Date().getUTCFullYear()}`).last, 2);
  assert.equal(notificationsOf(u1.id).length, 1);
});

test('failed ⇒ aucun abonnement, aucun reçu, motif lisible', async () => {
  const u = mkUser();
  const p = await payments.createSubscriptionPayment(u, input('rec_forme'));
  const r = await payments.settlePayment(p.id, { status: 'failed', failureReason: 'Solde insuffisant.' });
  assert.equal(r.status, 'failed');
  assert.equal(r.failureReason, 'Solde insuffisant.');
  assert.equal(r.receiptNumber, undefined);
  assert.equal(db.peek(`subscriptions/${u.id}_recruiter`), undefined);
  assert.equal(db.peek(`counters/receipts_${new Date().getUTCFullYear()}`), undefined, 'aucun numéro consommé');
  assert.equal(notificationsOf(u.id)[0].kind, 'payment');
});

test('un paiement réglé ne change plus d’état (paid ↔ failed impossible)', async () => {
  const u = mkUser();
  const paid = await payments.createSubscriptionPayment(u, input('rec_essentiel'));
  await payments.settlePayment(paid.id, { status: 'paid' });
  assert.equal((await payments.settlePayment(paid.id, { status: 'failed' })).status, 'paid');

  const failed = await payments.createSubscriptionPayment(u, input('rec_forme'));
  await payments.settlePayment(failed.id, { status: 'failed' });
  assert.equal((await payments.settlePayment(failed.id, { status: 'paid' })).status, 'failed');
  assert.equal(db.peek(`subscriptions/${u.id}_recruiter`).planCode, 'rec_essentiel', 'le paiement échoué n’active rien');
});

test('règlement d’un paiement inconnu ⇒ null', async () => {
  assert.equal(await payments.settlePayment('pay_000000000000000000000000', { status: 'paid' }), null);
});

test('même plan encore actif ⇒ prolongation ; autre plan ⇒ remplacement immédiat', async () => {
  const u = mkUser();
  const first = await payments.createSubscriptionPayment(u, input('rec_essentiel'));
  await payments.settlePayment(first.id, { status: 'paid' });
  const firstExpiry = Date.parse(db.peek(`subscriptions/${u.id}_recruiter`).expiresAt);

  const again = await payments.createSubscriptionPayment(u, input('rec_essentiel'));
  await payments.settlePayment(again.id, { status: 'paid' });
  const extended = Date.parse(db.peek(`subscriptions/${u.id}_recruiter`).expiresAt);
  assert.ok(Math.abs(extended - (firstExpiry + 30 * DAY)) < 1000, 'prolongé depuis l’échéance en cours');

  const upgrade = await payments.createSubscriptionPayment(u, input('rec_forme'));
  await payments.settlePayment(upgrade.id, { status: 'paid' });
  const sub = db.peek(`subscriptions/${u.id}_recruiter`);
  assert.equal(sub.planCode, 'rec_forme');
  assert.equal(sub.replacedPlanCode, 'rec_essentiel');
  assert.ok(Math.abs(Date.parse(sub.expiresAt) - (Date.now() + 30 * DAY)) < 60 * 1000, 'nouveau plan : 30 jours à partir de maintenant');
  assert.equal((await getActiveSubscriptions(u.id)).length, 1, 'un seul abonnement actif par audience');
});

// ─── Lecture : propriétaire, expiration ──────────────────────────────────────

test('GET paiement : réservé au propriétaire (404 sinon), identifiant mal formé ⇒ 404', async () => {
  const owner = mkUser();
  const p = await payments.createSubscriptionPayment(owner, input('rec_forme'));
  assert.equal((await payments.getPaymentForUser(owner, p.id)).id, p.id);
  await rejectsWith(payments.getPaymentForUser(mkUser(), p.id), 404);
  await rejectsWith(payments.getPaymentForUser(owner, '../users/x'), 404);
  await rejectsWith(payments.getMyPayment(mkUser(), p.id), 404);
});

test('un paiement pending sans réponse après 15 min passe expired à la lecture', async () => {
  const u = mkUser();
  const p = await payments.createSubscriptionPayment(u, input('rec_forme'));
  db.seed(`payments/${p.id}`, (({ simulation, ...rest }) => rest)(db.peek(`payments/${p.id}`))); // pas de règlement simulé
  ageCreatedAt(p.id, 16 * 60 * 1000);
  const r = await payments.getPaymentForUser(u, p.id);
  assert.equal(r.status, 'expired');
  assert.ok(r.failureReason.includes('Aucun montant'));
  assert.equal(db.peek(`subscriptions/${u.id}_recruiter`), undefined);
});

// ─── Historique, reçus, back-office ──────────────────────────────────────────

test('historique : plus récents d’abord, reçu seulement pour les paiements paid, plan nommé', async () => {
  const u = mkUser();
  const a = await payments.createSubscriptionPayment(u, input('rec_essentiel'));
  await payments.settlePayment(a.id, { status: 'paid' });
  const b = await payments.createSubscriptionPayment(u, input('rec_forme'));
  ageCreatedAt(a.id, 60 * 1000);
  const list = await payments.listMyPayments(u);
  assert.deepEqual(list.map((x) => x.id), [b.id, a.id]);
  const paid = list.find((x) => x.id === a.id);
  assert.match(paid.receiptNumber, /^REC-\d{4}-\d{6}$/);
  assert.deepEqual(paid.plan, { code: 'rec_essentiel', name: 'Essentiel' });
  assert.equal(list.find((x) => x.id === b.id).receiptNumber, undefined);
  assert.ok(!JSON.stringify(list).includes('677112233'));
  assert.deepEqual(await payments.listMyPayments(mkUser()), [], 'jamais les paiements des autres');
  assert.equal((await payments.getMyPayment(u, a.id)).receiptNumber, paid.receiptNumber);
});

test('historique : repli en mémoire si l’index composite manque', async () => {
  const u = mkUser();
  await payments.createSubscriptionPayment(u, input('rec_essentiel'));
  await payments.createSubscriptionPayment(u, input('rec_forme'));
  db.simulateMissingIndex = true;
  assert.equal((await payments.listMyPayments(u)).length, 2);
});

test('admin : filtres status/purpose, nom du payeur, filtre inconnu ⇒ 422', async () => {
  const u1 = mkUser({ name: 'Awa Kamga' });
  const u2 = mkUser();
  const a = await payments.createSubscriptionPayment(u1, input('rec_essentiel'));
  await payments.settlePayment(a.id, { status: 'paid' });
  await payments.createSubscriptionPayment(u2, input('rec_forme'));

  const all = await payments.listAdminPayments({});
  assert.equal(all.length, 2);
  const paid = await payments.listAdminPayments({ status: 'paid' });
  assert.equal(paid.length, 1);
  assert.equal(paid[0].userName, 'Awa Kamga');
  assert.equal(paid[0].webhook, 'missing');
  assert.equal((await payments.listAdminPayments({ status: 'pending', purpose: 'subscription' })).length, 1);
  assert.equal((await payments.listAdminPayments({ purpose: 'unlock_contact' })).length, 0);
  await rejectsWith(payments.listAdminPayments({ status: 'bidon' }), 422);
});

test('chiffres du jour du tableau de bord : montant payé, nombre, échecs 24 h', async () => {
  const u = mkUser();
  const a = await payments.createSubscriptionPayment(u, input('rec_forme'));
  const b = await payments.createSubscriptionPayment(u, input('rec_essentiel'));
  const c = await payments.createSubscriptionPayment(u, input('rec_premium'));
  await payments.settlePayment(a.id, { status: 'paid' });
  await payments.settlePayment(b.id, { status: 'paid' });
  await payments.settlePayment(c.id, { status: 'failed' });
  assert.deepEqual(await payments.paymentStatsToday(), { paymentsToday: 13000, paymentsTodayCount: 2, failedPayments24h: 1 });
});

// ─── Fournisseur réel (Orange) : la vérification serveur fait foi ────────────

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
/** Simule Orange. `state.status` pilote la réponse de /paymentstatus ; `state.down` coupe l’API. */
const mockOrange = (state) => {
  const calls = [];
  global.fetch = async (url, opts) => {
    const p = url.replace('https://orange.test', '');
    calls.push(p);
    if (state.down) throw Object.assign(new Error('ECONNRESET'), { name: 'TypeError' });
    if (p === '/token') return reply(200, { access_token: 'AT', expires_in: 3600 });
    if (p.endsWith('/mp/init')) return reply(200, { message: 'ok', data: { payToken: state.payToken || 'PT1' } });
    if (p.endsWith('/mp/pay')) return reply(200, { message: 'ok', data: {} });
    if (p.includes('/mp/paymentstatus/')) return reply(200, { data: state.tx });
    throw new Error(`appel inattendu ${p}`);
  };
  return calls;
};
const SUCCESS = (amount) => ({ status: 'SUCCESSFULL', amount, confirmtxnstatus: '200', confirmtxnmessage: 'ok' });
const live = async (state, plan = 'rec_forme') => {
  process.env.PAYMENT_PROVIDER = 'orange_cm';
  mockOrange(state);
  const u = mkUser();
  const p = await payments.createSubscriptionPayment(u, input(plan));
  return { u, p };
};

test('Orange : création ⇒ pending avec payToken ; opérateur MTN ⇒ 503 sans écriture', async () => {
  const { p } = await live({ tx: { status: 'PENDING' } });
  assert.equal(p.status, 'pending');
  assert.equal(db.peek(`payments/${p.id}`).operatorReference, 'PT1');
  assert.equal(db.peek(`payments/${p.id}`).provider, 'orange_cm');
  await rejectsWith(payments.createSubscriptionPayment(mkUser(), input('rec_forme', { operator: 'mtn_momo' })), 503, 'PAYMENT_UNAVAILABLE');
  assert.equal(docsOf('payments/').length, 1);
});

test('Orange : une demande rejetée par Orange ⇒ paiement failed (rien débité)', async () => {
  process.env.PAYMENT_PROVIDER = 'orange_cm';
  global.fetch = async (url) => {
    const p = url.replace('https://orange.test', '');
    if (p === '/token') return reply(200, { access_token: 'AT', expires_in: 3600 });
    if (p.endsWith('/mp/init')) return reply(200, { data: { payToken: 'PT9' } });
    return reply(400, { message: 'refusé' });
  };
  const p = await payments.createSubscriptionPayment(mkUser(), input('rec_forme'));
  assert.equal(p.status, 'failed');
});

test('Orange : un callback qui AFFIRME le succès ne règle rien tant qu’Orange dit PENDING', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { u, p } = await live(state);
  const found = await payments.handleProviderNotification('orange_cm', { payToken: 'PT1', status: 'SUCCESSFULL', amount: 8000 });
  assert.equal(found, true);
  const doc = db.peek(`payments/${p.id}`);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.webhook, 'received');
  assert.equal(db.peek(`subscriptions/${u.id}_recruiter`), undefined);
});

test('Orange : callback ⇒ vérification ⇒ paid, abonnement activé et reçu délivré', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { u, p } = await live(state);
  state.tx = SUCCESS(8000);
  await payments.handleProviderNotification('orange_cm', { payToken: 'PT1' });
  const doc = db.peek(`payments/${p.id}`);
  assert.equal(doc.status, 'paid');
  assert.match(doc.receiptNumber, /^REC-\d{4}-000001$/);
  assert.equal(db.peek(`subscriptions/${u.id}_recruiter`).planCode, 'rec_forme');
});

test('Orange : montant différent ou confirmation absente ⇒ jamais paid', async () => {
  const state = { tx: SUCCESS(100) };
  const { p } = await live(state);
  await payments.handleProviderNotification('orange_cm', { payToken: 'PT1' });
  assert.equal(db.peek(`payments/${p.id}`).status, 'pending');
  state.tx = { status: 'SUCCESSFULL', amount: 8000, confirmtxnstatus: null, confirmtxnmessage: null };
  await payments.handleProviderNotification('orange_cm', { payToken: 'PT1' });
  assert.equal(db.peek(`payments/${p.id}`).status, 'pending');
});

test('Orange : callback inconnu, mal formé ou injecté ⇒ ignoré', async () => {
  await live({ tx: { status: 'PENDING' } });
  assert.equal(await payments.handleProviderNotification('orange_cm', { payToken: 'INCONNU' }), false);
  assert.equal(await payments.handleProviderNotification('orange_cm', {}), false);
  assert.equal(await payments.handleProviderNotification('orange_cm', null), false);
  assert.equal(await payments.handleProviderNotification('orange_cm', { payToken: { $ne: '' } }), false);
  assert.equal(await payments.handleProviderNotification('inconnu', { payToken: 'PT1' }), false);
});

test('Orange : EXPIRED chez Orange ⇒ expired', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { p } = await live(state);
  state.tx = { status: 'EXPIRED' };
  await payments.handleProviderNotification('orange_cm', { payToken: 'PT1' });
  assert.equal(db.peek(`payments/${p.id}`).status, 'expired');
});

test('Orange : statut inconnu (ex. FAILED non confirmé) ⇒ reste pending', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { p } = await live(state);
  state.tx = { status: 'FAILED' };
  await payments.handleProviderNotification('orange_cm', { payToken: 'PT1' });
  assert.equal(db.peek(`payments/${p.id}`).status, 'pending');
});

test('Orange : délai de 15 min dépassé mais Orange injoignable ⇒ on n’expire PAS à l’aveugle', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { u, p } = await live(state);
  ageCreatedAt(p.id, 16 * 60 * 1000);
  state.down = true;
  assert.equal((await payments.getPaymentForUser(u, p.id)).status, 'pending');
  state.down = false; // Orange répond de nouveau : toujours PENDING ⇒ expire
  assert.equal((await payments.getPaymentForUser(u, p.id)).status, 'expired');
});

test('Orange : délai dépassé et paiement en réalité réussi ⇒ paid, pas expired', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { u, p } = await live(state);
  ageCreatedAt(p.id, 16 * 60 * 1000);
  state.tx = SUCCESS(8000);
  assert.equal((await payments.getPaymentForUser(u, p.id)).status, 'paid');
});

test('Orange : le suivi du front ne sollicite Orange qu’au plus toutes les 10 s', async () => {
  const state = { tx: { status: 'PENDING' } };
  const { u, p } = await live(state);
  const calls = mockOrange(state);
  await payments.getPaymentForUser(u, p.id);
  await payments.getPaymentForUser(u, p.id);
  await payments.getPaymentForUser(u, p.id);
  assert.equal(calls.filter((c) => c.includes('paymentstatus')).length, 1);
});

test('réconciliation admin : 404 / 409 NOT_PENDING / 409 NOT_RECONCILABLE / 502 / succès', async () => {
  // simulation : non vérifiable
  const sim = await payments.createSubscriptionPayment(mkUser(), input('rec_forme'));
  await rejectsWith(payments.reconcilePaymentForAdmin(sim.id), 409, 'NOT_RECONCILABLE');
  await rejectsWith(payments.reconcilePaymentForAdmin('pay_ffffffffffffffffffffffff'), 404);
  await rejectsWith(payments.reconcilePaymentForAdmin('n’importe quoi'), 404);

  const state = { tx: { status: 'PENDING' } };
  const { p } = await live(state);
  state.down = true;
  await rejectsWith(payments.reconcilePaymentForAdmin(p.id), 502, 'PROVIDER_UNREACHABLE');
  state.down = false;
  assert.equal((await payments.reconcilePaymentForAdmin(p.id)).status, 'pending');
  state.tx = SUCCESS(8000);
  const done = await payments.reconcilePaymentForAdmin(p.id);
  assert.equal(done.status, 'paid');
  assert.match(done.receiptNumber, /^REC-/);
  assert.equal(done.operatorReference, 'PT1');
  await rejectsWith(payments.reconcilePaymentForAdmin(p.id), 409, 'NOT_PENDING');
});

test('lot de réconciliation : règle les paiements Orange, ignore la simulation, survit à une panne', async () => {
  process.env.PAYMENT_PROVIDER = 'simulation';
  await payments.createSubscriptionPayment(mkUser(), input('rec_forme')); // simulation : hors lot

  const state = { tx: { status: 'PENDING' }, payToken: 'PTA' };
  process.env.PAYMENT_PROVIDER = 'orange_cm';
  mockOrange(state);
  const a = await payments.createSubscriptionPayment(mkUser(), input('rec_forme'));
  state.payToken = 'PTB';
  const b = await payments.createSubscriptionPayment(mkUser(), input('rec_forme'));
  // Orange ne connaît le succès que pour PTA
  global.fetch = async (url) => {
    const p = url.replace('https://orange.test', '');
    if (p === '/token') return reply(200, { access_token: 'AT', expires_in: 3600 });
    if (p.endsWith('/PTA')) return reply(200, { data: SUCCESS(8000) });
    return reply(200, { data: { status: 'PENDING' } });
  };
  const r = await payments.reconcilePendingBatch();
  assert.deepEqual(r, { checked: 2, settled: 1 });
  assert.equal(db.peek(`payments/${a.id}`).status, 'paid');
  assert.equal(db.peek(`payments/${b.id}`).status, 'pending');

  global.fetch = async () => { throw new TypeError('réseau coupé'); };
  assert.deepEqual(await payments.reconcilePendingBatch(), { checked: 1, settled: 0 });
});
