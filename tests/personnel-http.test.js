
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

process.env.NODE_ENV = 'test';

// Installer Firebase simulé avant de charger Express.
const { installFakeFirebase } = require('./helpers/fakeFirestore');
installFakeFirebase();

const app = require('../src/app');

test('HTTP : routes essentielles du Placement du personnel', async () => {
  // Démarrer un serveur local sur un port libre.
  const server = app.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const baseUrl =
    `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Vérifier la disponibilité du serveur.
    const health = await fetch(`${baseUrl}/health`);

    assert.equal(health.status, 200);

    const healthBody = await health.json();

    assert.equal(healthBody.success, true);

    // 2. Vérifier les référentiels de recherche.
    const options = await fetch(
      `${baseUrl}/api/search/options`
    );

    assert.equal(options.status, 200);

    const optionsBody = await options.json();

    assert.equal(optionsBody.success, true);

    // 3. Vérifier une recherche publique de candidats.
    const search = await fetch(
      `${baseUrl}/api/search?universe=personnel`
    );

    assert.equal(search.status, 200);

    const searchBody = await search.json();

    assert.equal(searchBody.success, true);

    // 4. Refuser un accès recruteur sans authentification.
    const recruiter = await fetch(
      `${baseUrl}/api/recruiter/access`
    );

    assert.equal(recruiter.status, 401);

  } finally {
    server.closeAllConnections?.();

    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
});

test('HTTP : un candidat connecté publie et retrouve son profil', async () => {
  const jwt = require('jsonwebtoken');
  const { db } = require('../src/config/firebase');
  const { clearUserCache } = require('../src/utils/userCache');
  const { JOBS, AVAILABILITIES } = require('../src/config/referentials');

  // Clé fictive uniquement pour ce processus de test.
  process.env.JWT_SECRET = 'ludra-http-test-secret-not-for-production';

  const userId = `http_candidate_${Date.now()}`;

  // Créer un utilisateur dans Firestore simulé.
  await db.collection('users').doc(userId).create({
    name: 'Candidat HTTP Test',
    role: 'client',
    isActive: true,
  });

  clearUserCache();

  // Générer un véritable JWT signé avec la clé de test.
  const token = jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Créer un brouillon candidat par HTTP.
    const created = await fetch(`${base}/api/drafts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'personnel',
        candidate: {
          job: JOBS[0].value,
          title: 'Professionnel expérimenté et disponible',
          summary:
            'Je possède plusieurs années d’expérience professionnelle et recherche un emploi stable.',
          city: 'Douala',
          experienceYears: 3,
          availability: AVAILABILITIES[0],
          skills: ['Organisation', 'Ponctualité'],
        },
      }),
    });

    const createdBody = await created.json();

    assert.equal(created.status, 201, JSON.stringify(createdBody));

    const draftId = createdBody.data?.id ?? createdBody.id;

    assert.ok(draftId, 'Le serveur doit retourner un ID de brouillon');

    // 2. Publier le brouillon par HTTP.
    const published = await fetch(
      `${base}/api/drafts/${draftId}/publish`,
      { method: 'POST', headers }
    );

    const publishedBody = await published.json();

    assert.equal(published.status, 200, JSON.stringify(publishedBody));

    // 3. Rechercher le candidat publié par HTTP.
    const search = await fetch(
      `${base}/api/search?universe=personnel&city=Douala`
    );

    const searchBody = await search.json();

    assert.equal(search.status, 200, JSON.stringify(searchBody));

    const items = searchBody.data?.items ?? searchBody.items;

    assert.ok(Array.isArray(items), 'La recherche doit retourner une liste');
    assert.ok(
      items.some((c) => c.id === userId),
      'Le candidat publié doit apparaître dans la recherche'
    );

    // 4. Consulter sa fiche détaillée.
    const detail = await fetch(
      `${base}/api/candidates/${userId}`
    );

    assert.equal(detail.status, 200);

  } finally {
    server.closeAllConnections?.();

    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
});

test('HTTP : un recruteur sans forfait ne peut pas utiliser la shortlist', async () => {
  const jwt = require('jsonwebtoken');
  const { db } = require('../src/config/firebase');
  const { clearUserCache } = require('../src/utils/userCache');

  process.env.JWT_SECRET = 'ludra-http-test-secret-not-for-production';

  const recruiterId = `http_recruiter_${Date.now()}`;

  // Créer un compte recruteur fictif.
  await db.collection('users').doc(recruiterId).create({
    name: 'Recruteur Test',
    role: 'recruteur',
    isActive: true,
  });

  clearUserCache();

  const token = jwt.sign(
    { id: recruiterId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Le recruteur consulte ses droits.
    const access = await fetch(
      `${base}/api/recruiter/access`,
      { headers }
    );

    const accessBody = await access.json();

    assert.equal(
      access.status,
      200,
      JSON.stringify(accessBody)
    );

    assert.equal(accessBody.success, true);

    // 2. Il essaie d'ajouter un candidat sans forfait.
    const response = await fetch(
      `${base}/api/recruiter/shortlist`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          candidateId: 'candidat_test_inexistant',
        }),
      }
    );

    const responseBody = await response.json();

    assert.equal(
      response.status,
      403,
      JSON.stringify(responseBody)
    );

    // 3. Vérifier le motif du refus.
    assert.equal(
      responseBody.code,
      'PLAN_REQUIRED'
    );

  } finally {
    server.closeAllConnections?.();

    await new Promise((resolve, reject) => {
      server.close((err) =>
        err ? reject(err) : resolve()
      );
    });
  }
});

test('HTTP : un recruteur avec forfait gère sa shortlist', async () => {
  const jwt = require('jsonwebtoken');
  const { db } = require('../src/config/firebase');
  const { clearUserCache } = require('../src/utils/userCache');
  const { invalidateSubscriptions } =
    require('../src/services/subscriptions.service');
  const { invalidateCandidate } =
    require('../src/services/candidates.service');

  process.env.JWT_SECRET = 'ludra-http-test-secret-not-for-production';

  const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const recruiterId = `http_recruiter_paid_${uniqueId}`;
  const candidateId = `http_candidate_shortlist_${uniqueId}`;

  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + 10 * 24 * 60 * 60 * 1000
  ).toISOString();

  // 1. Créer un recruteur fictif.
  await db.collection('users').doc(recruiterId).create({
    name: 'Recruteur HTTP Test',
    role: 'recruteur',
    isActive: true,
  });

  // 2. Créer un candidat actif dans Firestore simulé.
  await db.collection('candidates').doc(candidateId).create({
    userId: candidateId,
    status: 'active',
    title: 'Chauffeur professionnel',
    job: 'Chauffeur',
    jobCode: 'driver',
    city: 'Douala',
    experienceYears: 4,
    availability: 'immediate',
    trained: true,
    plan: 'gratuit',
    media: [],
    publishedAt: now,
    publisher: {
      id: candidateId,
      name: 'Candidat HTTP Shortlist',
      avatar: null,
      kind: 'candidate',
      verified: true,
    },
  });

  // 3. Attribuer un abonnement recruteur actif.
  await db.collection('subscriptions')
    .doc(`${recruiterId}_recruiter`)
    .create({
      userId: recruiterId,
      audience: 'recruiter',
      planCode: 'rec_essentiel',
      planName: 'Essentiel',
      status: 'active',
      startedAt: now,
      expiresAt,
    });

  // Invalider les caches pour prendre en compte les données.
  clearUserCache();
  invalidateSubscriptions(recruiterId);
  invalidateCandidate(candidateId);

  const token = jwt.sign(
    { id: recruiterId },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const base = `http://127.0.0.1:${server.address().port}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Effectuer une requête HTTP et lire sa réponse.
  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
    });

    const payload = await response.json();

    return { status: response.status, payload };
  };

  try {
    // 4. Vérifier les droits du recruteur.
    const access = await request(
      'GET',
      '/api/recruiter/access'
    );

    assert.equal(
      access.status,
      200,
      JSON.stringify(access.payload)
    );

    const rights = access.payload.data ?? access.payload;

    assert.equal(rights.planCode, 'rec_essentiel');
    assert.equal(rights.rights.shortlist, true);

    // 5. Ajouter le candidat à la shortlist.
    const added = await request(
      'POST',
      '/api/recruiter/shortlist',
      { candidateId }
    );

    assert.equal(
      added.status,
      200,
      JSON.stringify(added.payload)
    );

    // 6. Répéter l'ajout : aucun doublon autorisé.
    const addedAgain = await request(
      'POST',
      '/api/recruiter/shortlist',
      { candidateId }
    );

    assert.equal(
      addedAgain.status,
      200,
      JSON.stringify(addedAgain.payload)
    );

    const stored = await db.collection('shortlists')
      .doc(recruiterId)
      .get();

    assert.equal(stored.exists, true);
    assert.equal(stored.data().entries.length, 1);
    assert.equal(
      stored.data().entries[0].candidateId,
      candidateId
    );

    // 7. Consulter la shortlist par HTTP.
    const listed = await request(
      'GET',
      '/api/recruiter/shortlist'
    );

    assert.equal(
      listed.status,
      200,
      JSON.stringify(listed.payload)
    );

    const items = listed.payload.data ?? listed.payload;

    assert.ok(Array.isArray(items));
    assert.equal(items.length, 1);
    assert.equal(items[0].candidate.id, candidateId);

    // 8. Retirer le candidat de la shortlist.
    const removed = await request(
      'DELETE',
      `/api/recruiter/shortlist/${candidateId}`
    );

    assert.equal(
      removed.status,
      200,
      JSON.stringify(removed.payload)
    );

    // 9. Vérifier que la shortlist est vide.
    const afterRemoval = await db.collection('shortlists')
      .doc(recruiterId)
      .get();

    assert.deepEqual(afterRemoval.data().entries, []);

  } finally {
    server.closeAllConnections?.();

    await new Promise((resolve, reject) => {
      server.close((err) =>
        err ? reject(err) : resolve()
      );
    });
  }
});
