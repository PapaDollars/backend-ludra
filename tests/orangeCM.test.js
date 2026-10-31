const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  ORANGE_BASE_URL: 'https://orange.test', ORANGE_USERNAME: 'u', ORANGE_PASSWORD: 'p', ORANGE_X_AUTH_TOKEN: 'xat',
  ORANGE_CHANNEL_MSISDN: '690000001', ORANGE_PIN: '1234', ORANGE_NOTIF_URL: 'https://api.test/cb', ORANGE_WEBHOOK_SECRET: 's',
});
const orange = require('../src/services/providers/orangeCM');

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Remplace fetch par un script de réponses ; enregistre les appels. */
const mockFetch = (handler) => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, ...opts });
    return handler(url, opts, calls);
  };
  return calls;
};

const base = (url) => url.replace('https://orange.test', '');
const tokenReply = () => reply(200, { access_token: 'AT', expires_in: 3600 });
const payment = { id: 'pay_x', amount: 500, label: 'Plan', operatorReference: 'PT1' };

test.beforeEach(() => orange._resetTokenCache());

test('request : token → init → pay, corps et en-têtes conformes à orangemoney-go', async () => {
  const calls = mockFetch((url) => {
    const p = base(url);
    if (p === '/token') return tokenReply();
    if (p === '/omcoreapis/1.0.2/mp/init') return reply(200, { message: 'ok', data: { payToken: 'PT1' } });
    if (p === '/omcoreapis/1.0.2/mp/pay') return reply(200, { message: 'ok', data: {} });
    throw new Error(`appel inattendu ${p}`);
  });
  const r = await orange.request(payment, { payerPhone: '677112233' });
  assert.deepEqual(r, { operatorReference: 'PT1' });
  assert.deepEqual(calls.map((c) => base(c.url)), ['/token', '/omcoreapis/1.0.2/mp/init', '/omcoreapis/1.0.2/mp/pay']);
  assert.match(calls[0].headers.Authorization, /^Basic /);
  assert.equal(calls[0].body, 'grant_type=client_credentials');
  assert.equal(calls[2].headers.Authorization, 'Bearer AT');
  assert.equal(calls[2].headers['X-AUTH-TOKEN'], 'xat');
  assert.deepEqual(JSON.parse(calls[2].body), {
    subscriberMsisdn: '677112233', channelUserMsisdn: '690000001', amount: '500', description: 'Plan',
    orderId: 'pay_x', pin: '1234', payToken: 'PT1', notifUrl: 'https://api.test/cb',
  });
});

test('request : rejet explicite de /pay ⇒ erreur (paiement failed)', async () => {
  mockFetch((url) => {
    const p = base(url);
    if (p === '/token') return tokenReply();
    if (p.endsWith('/init')) return reply(200, { data: { payToken: 'PT1' } });
    return reply(400, { message: 'refusé' });
  });
  await assert.rejects(orange.request(payment, { payerPhone: '677112233' }), /HTTP 400/);
});

test('request : /pay ambigu (5xx) ⇒ reste pending, le payToken est conservé', async () => {
  mockFetch((url) => {
    const p = base(url);
    if (p === '/token') return tokenReply();
    if (p.endsWith('/init')) return reply(200, { data: { payToken: 'PT1' } });
    return reply(503, {});
  });
  assert.deepEqual(await orange.request(payment, { payerPhone: '677112233' }), { operatorReference: 'PT1' });
});

test('getStatus : SUCCESSFULL confirmé + bon montant ⇒ paid', async () => {
  mockFetch((url) => (base(url) === '/token' ? tokenReply()
    : reply(200, { data: { status: 'SUCCESSFULL', amount: 500, confirmtxnstatus: '200', confirmtxnmessage: 'ok' } })));
  assert.deepEqual(await orange.getStatus(payment), { status: 'paid' });
});

test('getStatus : SUCCESSFULL sans confirmation ⇒ pending (jamais paid)', async () => {
  mockFetch((url) => (base(url) === '/token' ? tokenReply()
    : reply(200, { data: { status: 'SUCCESSFULL', amount: 500, confirmtxnstatus: null, confirmtxnmessage: null } })));
  assert.deepEqual(await orange.getStatus(payment), { status: 'pending' });
});

test('getStatus : montant différent ⇒ pending', async () => {
  mockFetch((url) => (base(url) === '/token' ? tokenReply()
    : reply(200, { data: { status: 'SUCCESSFULL', amount: 100, confirmtxnstatus: '200', confirmtxnmessage: 'ok' } })));
  assert.deepEqual(await orange.getStatus(payment), { status: 'pending' });
});

test('getStatus : EXPIRED ⇒ expired ; PENDING et statut inconnu ⇒ pending', async () => {
  for (const [status, expected] of [['EXPIRED', 'expired'], ['PENDING', 'pending'], ['???', 'pending']]) {
    mockFetch((url) => (base(url) === '/token' ? tokenReply() : reply(200, { data: { status } })));
    assert.equal((await orange.getStatus(payment)).status, expected);
  }
});

test('le jeton est mis en cache et vidé sur 401', async () => {
  let tokens = 0;
  mockFetch((url) => {
    if (base(url) === '/token') { tokens += 1; return tokenReply(); }
    return reply(200, { data: { status: 'PENDING' } });
  });
  await orange.getStatus(payment);
  await orange.getStatus(payment);
  assert.equal(tokens, 1);
  mockFetch((url) => (base(url) === '/token' ? (tokens += 1, tokenReply()) : reply(401, {})));
  await assert.rejects(orange.getStatus(payment), /HTTP 401/);
  mockFetch((url) => (base(url) === '/token' ? (tokens += 1, tokenReply()) : reply(200, { data: { status: 'PENDING' } })));
  await orange.getStatus(payment);
  assert.equal(tokens, 2);
});

test('extractReference : payToken top-level ou data.payToken, sinon null', () => {
  assert.equal(orange.extractReference({ payToken: 'A' }), 'A');
  assert.equal(orange.extractReference({ data: { payToken: 'B' } }), 'B');
  assert.equal(orange.extractReference({}), null);
  assert.equal(orange.extractReference(null), null);
  assert.equal(orange.extractReference({ payToken: { $ne: '' } }), null);
});

test('missingConfig liste les variables absentes', () => {
  const saved = process.env.ORANGE_PIN;
  delete process.env.ORANGE_PIN;
  assert.deepEqual(orange.missingConfig(), ['ORANGE_PIN']);
  process.env.ORANGE_PIN = saved;
});
