
const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeFirebase } = require('./helpers/fakeFirestore');

// Utiliser une base simulée, jamais la production.
process.env.NODE_ENV = 'test';
installFakeFirebase();

const drafts = require('../src/services/drafts.service');

const {
  getCandidate,
  findActiveCandidates,
} = require('../src/services/candidates.service');

const {
  JOBS,
  AVAILABILITIES,
} = require('../src/config/referentials');

let counter = 0;

function makeUser() {
  counter += 1;

  return {
    id: `test_candidate_${counter}`,
    name: `Candidat Test ${counter}`,
    isActive: true,
  };
}

function validCandidate() {
  return {
    job: JOBS[0].value,
    title: 'Professionnel expérimenté et disponible',
    summary:
      'Je possède plusieurs années d’expérience et recherche un emploi stable dans mon domaine.',
    city: 'Douala',
    experienceYears: 3,
    availability: AVAILABILITIES[0],
    skills: ['Ponctualité', 'Organisation'],
  };
}

// TEST 1 : Création et publication

test('Créer et publier un profil candidat', async () => {
  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    step: 0,
  });

  assert.ok(draft.id);

  await drafts.updateDraft(user.id, draft.id, {
    candidate: validCandidate(),
  });

  const result = await drafts.publishDraft(user, draft.id);

  assert.equal(result.status, 'published');
  assert.equal(result.universe, 'personnel');
  assert.equal(result.itemId, user.id);

  const profile = await getCandidate(user.id);

  assert.ok(profile);
  assert.equal(profile.city, 'Douala');
  assert.equal(profile.experienceYears, 3);
  assert.equal(profile.status, 'active');
});

// TEST 2 : Recherche du candidat publié

test('Un profil publié apparaît dans la recherche', async () => {
  const user = makeUser();
  const candidate = validCandidate();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate,
  });

  await drafts.publishDraft(user, draft.id);

  const results = await findActiveCandidates({
    job: candidate.job,
    city: candidate.city,
  });

  assert.ok(results.some((c) => c.id === user.id));
});

// TEST 3 : Refus des données incomplètes

test('Un profil incomplet est refusé', async () => {
  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: {
      title: 'Test',
    },
  });

  await assert.rejects(
    drafts.publishDraft(user, draft.id),
    (error) => error.statusCode === 422
  );

  const saved = await drafts.getDraft(user.id, draft.id);
  assert.ok(saved);
});

// TEST 4 : Protection des brouillons

test('Un utilisateur ne peut pas modifier le brouillon d’autrui', async () => {
  const owner = makeUser();
  const other = makeUser();

  const draft = await drafts.createDraft(owner, {
    type: 'personnel',
  });

  await assert.rejects(
    drafts.updateDraft(other.id, draft.id, {
      candidate: validCandidate(),
    }),
    (error) => error.statusCode === 404
  );
});

// TEST 5 : Sauvegarde partielle des données

test('Modifier une ville sans perdre les autres informations', async () => {
  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: validCandidate(),
  });

  await drafts.updateDraft(user.id, draft.id, {
    candidate: {
      city: 'Yaoundé',
    },
  });

  const updated = await drafts.getDraft(user.id, draft.id);

  assert.equal(updated.candidate.city, 'Yaoundé');
  assert.equal(updated.candidate.experienceYears, 3);
  assert.equal(
    updated.candidate.title,
    'Professionnel expérimenté et disponible'
  );
});
