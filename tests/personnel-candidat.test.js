
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
  invalidateCandidate,
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


test('Un propriétaire ne peut pas créer un profil candidat pour autrui', async () => {
  const owner = {
    ...makeUser(),
    role: 'proprietaire',
  };

  await assert.rejects(
    drafts.createDraft(owner, {
      type: 'personnel',
      candidate: validCandidate(),
      onBehalfOf: {
        userId: 'autre_candidat_123',
      },
    }),
    (error) => error.statusCode === 403
  );
});

test('Un ancien brouillon délégué ne peut pas publier un candidat', async () => {
  const { db } = require('../src/config/firebase');

  const owner = {
    ...makeUser(),
    role: 'proprietaire',
  };

  const draft = await drafts.createDraft(owner, {
    type: 'personnel',
    candidate: validCandidate(),
  });

  // Simule un ancien brouillon contenant une délégation.
  await db.collection('drafts').doc(draft.id).update({
    onBehalfOf: {
      userId: 'autre_candidat_456',
      name: 'Candidat externe',
    },
  });

  await assert.rejects(
    drafts.publishDraft(owner, draft.id),
    (error) => error.statusCode === 403
  );
});

test('Deux publications simultanées ne doivent pas traiter deux fois le même brouillon', async () => {
  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: validCandidate(),
  });

  // Simuler deux clics sur le bouton Publier.
  const results = await Promise.allSettled([
    drafts.publishDraft(user, draft.id),
    drafts.publishDraft(user, draft.id),
  ]);

  const successes = results.filter(
    (result) => result.status === 'fulfilled'
  );

  // Une seule requête doit réellement publier le brouillon.
  assert.equal(
    successes.length,
    1,
    'Un même brouillon ne doit être publié qu’une seule fois'
  );

  // Le profil candidat doit exister après publication.
  const profile = await getCandidate(user.id);

  assert.ok(profile);
  assert.equal(profile.status, 'active');
});

test('Un candidat peut corriger un brouillon après un échec de publication', async () => {
  const user = makeUser();

  // Création d'un profil volontairement incomplet.
  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: {
      title: 'Test',
    },
  });

  // La première publication doit échouer.
  await assert.rejects(
    drafts.publishDraft(user, draft.id),
    (error) => error.statusCode === 422
  );

  // Le candidat complète son profil.
  await drafts.updateDraft(user.id, draft.id, {
    candidate: validCandidate(),
  });

  // Il doit pouvoir publier à nouveau.
  const result = await drafts.publishDraft(user, draft.id);

  assert.equal(result.status, 'published');
  assert.equal(result.itemId, user.id);

  const profile = await getCandidate(user.id);

  assert.ok(profile);
  assert.equal(profile.status, 'active');
});

test('Recherche : filtrer les candidats par ville et expérience', async () => {
  const junior = makeUser();
  const senior = makeUser();

  // Premier candidat : 1 an d'expérience.
  const juniorDraft = await drafts.createDraft(junior, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Bafoussam',
      experienceYears: 1,
    },
  });

  await drafts.publishDraft(junior, juniorDraft.id);

  // Deuxième candidat : 7 ans d'expérience.
  const seniorDraft = await drafts.createDraft(senior, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Bafoussam',
      experienceYears: 7,
    },
  });

  await drafts.publishDraft(senior, seniorDraft.id);

  // Recherche : Bafoussam, au moins 5 ans d'expérience.
  const results = await findActiveCandidates({
    city: 'Bafoussam',
    experienceMin: 5,
  });

  // Le candidat expérimenté doit apparaître.
  assert.ok(
    results.some((c) => c.id === senior.id),
    'Le candidat avec 7 ans doit apparaître'
  );

  // Le candidat junior doit être exclu.
  assert.ok(
    !results.some((c) => c.id === junior.id),
    'Le candidat avec 1 an doit être exclu'
  );
});

test('Recherche : filtrer les candidats par métier', async () => {
  const candidatA = makeUser();
  const candidatB = makeUser();

  // Deux métiers différents.
  const metierA = JOBS[0].value;
  const metierB = JOBS[1].value;

  assert.notEqual(metierA, metierB);

  // Premier candidat.
  const draftA = await drafts.createDraft(candidatA, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      job: metierA,
      city: 'Bertoua',
    },
  });

  await drafts.publishDraft(candidatA, draftA.id);

  // Deuxième candidat avec un autre métier.
  const draftB = await drafts.createDraft(candidatB, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      job: metierB,
      city: 'Bertoua',
    },
  });

  await drafts.publishDraft(candidatB, draftB.id);

  // Rechercher uniquement le premier métier.
  const results = await findActiveCandidates({
    job: metierA,
    city: 'Bertoua',
  });

  assert.ok(
    results.some((c) => c.id === candidatA.id),
    'Le candidat du métier recherché doit apparaître'
  );

  assert.ok(
    !results.some((c) => c.id === candidatB.id),
    'Le candidat d’un autre métier doit être exclu'
  );
});

test('Recherche : filtrer les candidats par disponibilité', async () => {
  const candidatA = makeUser();
  const candidatB = makeUser();

  const disponibiliteA = AVAILABILITIES[0];
  const disponibiliteB = AVAILABILITIES[1];

  assert.notEqual(disponibiliteA, disponibiliteB);

  const draftA = await drafts.createDraft(candidatA, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Maroua',
      availability: disponibiliteA,
    },
  });

  await drafts.publishDraft(candidatA, draftA.id);

  const draftB = await drafts.createDraft(candidatB, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Maroua',
      availability: disponibiliteB,
    },
  });

  await drafts.publishDraft(candidatB, draftB.id);

  const results = await findActiveCandidates({
    city: 'Maroua',
    availability: disponibiliteA,
  });

  assert.ok(
    results.some((c) => c.id === candidatA.id),
    'Le candidat ayant la disponibilité recherchée doit apparaître'
  );

  assert.ok(
    !results.some((c) => c.id === candidatB.id),
    'Le candidat ayant une autre disponibilité doit être exclu'
  );
});

test('Recherche : filtrer les candidats selon le budget salarial', async () => {
  const candidatA = makeUser();
  const candidatB = makeUser();

  // Candidat A : salaire compatible avec le budget.
  const draftA = await drafts.createDraft(candidatA, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Garoua',
      salaryMin: 80000,
      salaryMax: 120000,
    },
  });

  await drafts.publishDraft(candidatA, draftA.id);

  // Candidat B : salaire au-dessus du budget.
  const draftB = await drafts.createDraft(candidatB, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Garoua',
      salaryMin: 250000,
      salaryMax: 300000,
    },
  });

  await drafts.publishDraft(candidatB, draftB.id);

  // Le recruteur dispose de 150 000 FCFA maximum.
  const results = await findActiveCandidates({
    city: 'Garoua',
    salaryMax: 150000,
  });

  assert.ok(
    results.some((c) => c.id === candidatA.id),
    'Le candidat compatible avec le budget doit apparaître'
  );

  assert.ok(
    !results.some((c) => c.id === candidatB.id),
    'Le candidat trop cher doit être exclu'
  );
});

test('Recherche : distinguer formation déclarée et vérifiée', async () => {
  const { db } = require('../src/config/firebase');

  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      city: 'Kribi',
      training: 'Formation professionnelle de six mois',
    },
  });

  await drafts.publishDraft(user, draft.id);

  const filters = {
    city: 'Kribi',
    trainedOnly: true,
  };

  // Une formation déclarée ne suffit pas.
  const before = await findActiveCandidates(filters);

  assert.ok(
    !before.some((c) => c.id === user.id),
    'Une formation non vérifiée ne doit pas suffire'
  );

  // Simuler la validation de la formation par le système.
  await db.collection('candidates').doc(user.id).update({
    trained: true,
  });
  await invalidateCandidate(user.id);
const savedSnapshot = await db
  .collection('candidates')
  .doc(user.id)
  .get();



const allKribi = await findActiveCandidates({
  city: 'Kribi',
});



const trainedKribi = await findActiveCandidates({
  city: 'Kribi',
  trainedOnly: true,
});




  const after = await findActiveCandidates(filters);

  assert.ok(
    after.some((c) => c.id === user.id),
    'Le candidat formé et vérifié doit apparaître'
  );
});
