
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sortCandidates,
  effectivePlan,
  relevance,
} = require('../src/services/personnelRanking');

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const PUBLICATION = '2026-11-04T12:00:00.000Z';
const EXPIRATION = '2026-12-05T12:00:00.000Z';

// Créer un candidat fictif pour les tests.
function candidate(id, plan = 'gratuit', overrides = {}) {
  return {
    id,
    status: 'active',
    title: 'Agent professionnel expérimenté',
    job: 'Agent',
    jobCode: 'agent',
    city: 'Yaoundé',
    skills: ['Organisation'],
    trained: false,
    publisher: { verified: false },
    publishedAt: PUBLICATION,
    plan,
    planExpiresAt: EXPIRATION,
    ...overrides,
  };
}

test('Classement : Premium > Standard > Gratuit à pertinence égale', () => {
  const candidats = [
    candidate('gratuit', 'gratuit'),
    candidate('standard', 'standard'),
    candidate('premium', 'premium'),
  ];

  const sorted = sortCandidates(
    candidats,
    { q: '', sort: 'pertinence' },
    { now: NOW, maxPlanBoostPercent: 20 }
  );

  assert.deepEqual(
    sorted.map((c) => c.id),
    ['premium', 'standard', 'gratuit']
  );
});

test('Pertinence pure : aucun avantage lié au forfait', () => {
  const candidats = [
    candidate('z-premium', 'premium'),
    candidate('a-gratuit', 'gratuit'),
  ];

  const sorted = sortCandidates(
    candidats,
    { q: '', sort: 'pertinence_pure' },
    { now: NOW, maxPlanBoostPercent: 20 }
  );

  // À score et date identiques, tri stable par identifiant.
  assert.deepEqual(
    sorted.map((c) => c.id),
    ['a-gratuit', 'z-premium']
  );
});

test('Un forfait Premium expiré perd son avantage', () => {
  const expired = candidate('a-expired', 'premium', {
    planExpiresAt: '2026-11-01T12:00:00.000Z',
  });

  const gratuit = candidate('z-gratuit', 'gratuit');

  assert.equal(effectivePlan(expired, NOW), 'gratuit');

  const sorted = sortCandidates(
    [gratuit, expired],
    { q: '', sort: 'pertinence' },
    { now: NOW, maxPlanBoostPercent: 20 }
  );

  assert.deepEqual(
    sorted.map((c) => c.id),
    ['a-expired', 'z-gratuit']
  );
});

test('Tri récent : le plus récent apparaît en premier', () => {
  const ancien = candidate('ancien', 'premium', {
    publishedAt: '2026-10-01T12:00:00.000Z',
  });

  const recent = candidate('recent', 'gratuit', {
    publishedAt: '2026-11-04T12:00:00.000Z',
  });

  const sorted = sortCandidates(
    [ancien, recent],
    { q: '', sort: 'recent' },
    { now: NOW }
  );

  assert.equal(sorted[0].id, 'recent');
});

test('La priorité aux candidats formés augmente leur pertinence', () => {
  const forme = candidate('forme', 'gratuit', {
    trained: true,
  });

  const scoreNormal = relevance(
    forme,
    [],
    NOW,
    { trainedPriority: false }
  );

  const scorePrioritaire = relevance(
    forme,
    [],
    NOW,
    { trainedPriority: true }
  );

  assert.equal(scorePrioritaire - scoreNormal, 15);
});
