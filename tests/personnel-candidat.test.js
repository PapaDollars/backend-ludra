
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


test('Deux publications simultanées renvoient le même résultat sans republier', async () => {
  const { db } = require('../src/config/firebase');

  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: validCandidate(),
  });

  // 1. Simuler deux clics simultanés sur Publier.
  const results = await Promise.allSettled([
    drafts.publishDraft(user, draft.id),
    drafts.publishDraft(user, draft.id),
  ]);

  // 2. Les deux demandes doivent réussir.
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'fulfilled');

  // 3. Elles doivent retourner exactement le même résultat.
  const firstResult = results[0].value;
  const secondResult = results[1].value;

  assert.deepEqual(
    secondResult,
    firstResult,
    'Les deux requêtes doivent retourner le même résultat'
  );

  assert.equal(firstResult.itemId, user.id);
  assert.equal(firstResult.universe, 'personnel');

  // 4. Le profil candidat doit exister.
  const profile = await getCandidate(user.id);

  assert.ok(profile);
  assert.equal(profile.status, 'active');

  // 5. Le brouillon doit avoir été supprimé.
  const draftSnapshot = await db
    .collection('drafts')
    .doc(draft.id)
    .get();

  assert.equal(
    draftSnapshot.exists,
    false,
    'Le brouillon doit disparaître après publication'
  );

  // 6. La trace de publication doit être confirmée.
  const claimSnapshot = await db
    .collection('draft_publish_claims')
    .doc(draft.id)
    .get();

  assert.equal(claimSnapshot.exists, true);
  assert.equal(claimSnapshot.data().status, 'published');

  assert.deepEqual(
    claimSnapshot.data().result,
    firstResult,
    'Le résultat doit être conservé pour les nouvelles tentatives'
  );

  // 7. Sauvegarder l'état du profil avant une nouvelle tentative.
  const profileRef = db.collection('candidates').doc(user.id);
  const beforeReplay = (await profileRef.get()).data();

  // Simuler une nouvelle demande après la publication.
  const replayResult = await drafts.publishDraft(user, draft.id);

  assert.deepEqual(
    replayResult,
    firstResult,
    'Une nouvelle tentative doit récupérer le résultat initial'
  );

  // 8. Vérifier qu'aucune réécriture du profil n'a eu lieu.
  const afterReplay = (await profileRef.get()).data();

  assert.deepEqual(
    afterReplay,
    beforeReplay,
    'Une nouvelle tentative ne doit pas modifier le profil publié'
  );
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

test('Publication atomique : une erreur conserve le brouillon et annule les écritures', async () => {
  const { db } = require('../src/config/firebase');

  const user = makeUser();

  const draft = await drafts.createDraft(user, {
    type: 'personnel',
    candidate: {
      ...validCandidate(),
      training: 'Formation professionnelle certifiée',
    },
  });

  // Simuler une panne au moment de créer la confirmation.
  const originalCreate = db._create;

  db._create = function (path, data) {
    if (path === `draft_publish_claims/${draft.id}`) {
      throw new Error('SIMULATED_TRANSACTION_WRITE_FAILURE');
    }

    return originalCreate.call(this, path, data);
  };

  try {
    await assert.rejects(
      drafts.publishDraft(user, draft.id),
      /SIMULATED_TRANSACTION_WRITE_FAILURE/
    );
  } finally {
    // Restaurer systématiquement le simulateur.
    db._create = originalCreate;
  }

  // Le profil ne doit pas avoir été enregistré.
  const profile = await db.collection('candidates')
    .doc(user.id)
    .get();

  assert.equal(profile.exists, false);

  // Le brouillon doit être conservé.
  const draftSnapshot = await db.collection('drafts')
    .doc(draft.id)
    .get();

  assert.equal(draftSnapshot.exists, true);

  // Aucune confirmation de publication ne doit exister.
  const claim = await db.collection('draft_publish_claims')
    .doc(draft.id)
    .get();

  assert.equal(claim.exists, false);

  // Une éventuelle preuve de formation doit aussi être annulée.
  const proof = await db.collection('proofs')
    .doc(`training_${user.id}`)
    .get();

  assert.equal(proof.exists, false);

  // Après la panne simulée, le candidat peut réessayer.
  const result = await drafts.publishDraft(user, draft.id);

  assert.equal(result.itemId, user.id);
  assert.equal(result.status, 'published');
});
