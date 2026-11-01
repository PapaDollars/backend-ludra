const { db } = require('../config/firebase');
const { DEFAULT_PLANS, DEFAULT_RECRUITER_RIGHTS, NO_RECRUITER_RIGHTS } = require('../config/plans');

/**
 * Paramètres administrables (`AdminSettings`, contrat V2.1 étape 11), document `settings/app`.
 * Valeurs par défaut dans src/config/plans.js ; le document ne contient que les surcharges.
 * Cache mémoire 5 min (règle de coût n° 6) : la future route `PUT /admin/settings` doit appeler
 * `invalidateSettings()` après écriture.
 */
const TTL_MS = 5 * 60 * 1000;
const PLAN_FIELDS = ['name', 'price', 'period', 'durationDays', 'features', 'recommended', 'tone', 'rank', 'active'];

const DEFAULT_RANKING = { organicQuotaPercent: 60, maxPlanBoostPercent: 20 };

let cache = null; // { value, expires }

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const build = (data) => {
  const overrides = Array.isArray(data.plans) ? data.plans : [];
  const plans = DEFAULT_PLANS.map((p) => {
    const o = overrides.find((x) => x && x.code === p.code) || {};
    return { ...p, active: true, ...pick(o, PLAN_FIELDS) };
  });

  const recruiterRights = Object.fromEntries(Object.entries(DEFAULT_RECRUITER_RIGHTS).map(([code, rights]) => {
    const o = (data.recruiterRights && data.recruiterRights[code]) || {};
    return [code, { ...rights, ...pick(o, Object.keys(NO_RECRUITER_RIGHTS)) }];
  }));

  return {
    plans,
    recruiterRights,
    ranking: { ...DEFAULT_RANKING, ...pick(data.ranking || {}, Object.keys(DEFAULT_RANKING)) },
  };
};

/** Paramètres effectifs (défauts + surcharges du back-office). */
const getSettings = async () => {
  if (cache && cache.expires > Date.now()) return cache.value;
  let data = {};
  try {
    const doc = await db.collection('settings').doc('app').get();
    data = doc.exists ? doc.data() : {};
  } catch (err) {
    if (cache) return cache.value; // Firestore indisponible : on garde les dernières valeurs connues
    throw err;
  }
  const value = build(data);
  cache = { value, expires: Date.now() + TTL_MS };
  return value;
};

const invalidateSettings = () => { cache = null; };

/** Plans actifs d'une audience, triés par rang (forme `Plan`, sans `active`). */
const getPlans = async (audience) => {
  const { plans } = await getSettings();
  return plans
    .filter((p) => p.active && (!audience || p.audience === audience))
    .sort((a, b) => a.rank - b.rank)
    .map(({ active, ...p }) => p); // eslint-disable-line no-unused-vars
};

/** Plan par code (y compris inactif : `active` indique s'il peut encore être souscrit). */
const findPlan = async (code) => {
  const { plans } = await getSettings();
  return plans.find((p) => p.code === code) || null;
};

/** Droits d'un forfait recruteur (aucun droit si le code est inconnu). */
const recruiterRightsFor = async (planCode) => {
  const { recruiterRights } = await getSettings();
  return (planCode && recruiterRights[planCode]) || { ...NO_RECRUITER_RIGHTS };
};

module.exports = { getSettings, invalidateSettings, getPlans, findPlan, recruiterRightsFor };
