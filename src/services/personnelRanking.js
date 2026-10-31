/**
 * Filtres et classement des profils candidats (M10 / M13). Module pur : aucune dépendance Firestore.
 *
 * Classement (§11) :
 *  - pertinence : texte (si `q`) + confiance (identité vérifiée, formé, références contrôlées) + fraîcheur ;
 *  - `pertinence`      : pertinence × (1 + bonus de plan borné), bonus ≤ `maxPlanBoostPercent` % (Premium > Standard > Gratuit) ;
 *  - `pertinence_pure` : pertinence seule, aucun effet des plans candidats (critère M13) ;
 *  - `recent`          : date de publication décroissante.
 * Les profils gratuits ne sont jamais exclus : le plan ne change que l'ordre.
 */
const { normalize, tokenize } = require('../utils/text');
const { AVAILABILITIES } = require('../config/referentials');

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_LEVEL = { gratuit: 0, standard: 1, premium: 2 };
const MAX_PLAN_LEVEL = 2;
const SORTS = ['pertinence', 'pertinence_pure', 'recent', 'prix_asc', 'prix_desc'];
const UNIVERSES = ['immobilier', 'personnel', 'services'];

const str = (v, max = 100) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v) => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const bool = (v) => v === 'true' || v === true;

/**
 * Query string → filtres (`SearchFilters`). Paramètre inconnu ou invalide → ignoré (contrat étape 2).
 * Seuls les champs communs et ceux de l'univers `personnel` sont conservés.
 */
const parseSearchFilters = (query = {}) => {
  const universe = UNIVERSES.includes(query.universe) ? query.universe : null;
  const availability = AVAILABILITIES.includes(query.availability) ? query.availability : undefined;
  const f = {
    universe,
    q: str(query.q),
    city: str(query.city, 60),
    district: str(query.district, 60),
    verifiedOnly: bool(query.verifiedOnly) || undefined,
    sort: SORTS.includes(query.sort) ? query.sort : 'pertinence',
  };
  if (universe === 'personnel') {
    Object.assign(f, {
      job: str(query.job, 60),
      experienceMin: num(query.experienceMin),
      availability,
      trainedOnly: bool(query.trainedOnly) || undefined,
      salaryMax: num(query.salaryMax),
    });
  }
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
};

/** Niveau de visibilité effectif : un plan expiré redevient « gratuit ». */
const effectivePlan = (c, now = Date.now()) => (
  c.plan && c.plan !== 'gratuit' && c.planExpiresAt && Date.parse(c.planExpiresAt) > now ? c.plan : 'gratuit'
);

/** Texte de recherche d'un profil (titre, métier, ville, quartier, compétences, nom du candidat). */
const keywordsOf = (c) => normalize([
  c.title, c.job, c.jobCode, c.city, c.district, ...(c.skills || []), c.publisher && c.publisher.name,
].filter(Boolean).join(' '));

/** Le profil (document Firestore `candidates`) correspond-il aux filtres ? */
const matchesFilters = (c, f, tokens = tokenize(f.q)) => {
  if (c.status !== 'active') return false;
  if (f.job && c.jobCode !== f.job) return false;
  if (f.city && c.city !== f.city) return false;
  if (f.district && c.district !== f.district) return false;
  if (f.verifiedOnly && !(c.publisher && c.publisher.verified)) return false;
  if (f.trainedOnly && !c.trained) return false;
  if (f.availability === 'immediate' && c.availability !== 'immediate') return false;
  // « Sous 15 jours » inclut « immédiate »
  if (f.availability === 'sous_15_jours' && !['immediate', 'sous_15_jours'].includes(c.availability)) return false;
  if (f.availability === 'a_convenir' && c.availability !== 'a_convenir') return false;
  if (f.experienceMin !== undefined && !((c.experienceYears || 0) >= f.experienceMin)) return false;
  // Budget recruteur : profils dont le salaire visé minimum est ≤ au budget (sans attente indiquée : inclus)
  if (f.salaryMax !== undefined && c.salaryMin != null && c.salaryMin > f.salaryMax) return false;
  if (tokens.length) {
    const kw = c.keywords || keywordsOf(c);
    if (!tokens.every((t) => kw.includes(t))) return false;
  }
  return true;
};

/** Score de pertinence (0 à ~115), indépendant des plans candidats. */
const relevance = (c, tokens, now, { trainedPriority = false } = {}) => {
  let s = 0;
  if (tokens.length) {
    // Mot trouvé dans le titre ou le métier : poids fort ; ailleurs (quartier, compétence, nom) : poids faible
    const strong = normalize(`${c.title} ${c.job} ${c.jobCode}`);
    s += tokens.reduce((n, t) => n + (strong.includes(t) ? 40 : 20), 0) / tokens.length;
  }
  if (c.publisher && c.publisher.verified) s += 15;
  if (c.trained) s += 15;
  s += Math.min(2, (c.references && c.references.verified) || 0) * 5;
  const ageDays = (now - Date.parse(c.publishedAt || c.createdAt || 0)) / DAY_MS;
  s += 20 * Math.max(0, 1 - ageDays / 60);
  // Forfait recruteur « Formé » ou « Premium » : priorité aux profils formés (droit trainedPriority)
  if (trainedPriority && c.trained) s += 15;
  return s;
};

/**
 * Trie des profils (documents avec `id`) selon `sort`. Ne modifie pas la liste reçue.
 * @param {{ maxPlanBoostPercent?: number, trainedPriority?: boolean, now?: number }} opts
 */
const sortCandidates = (list, f, { maxPlanBoostPercent = 20, trainedPriority = false, now = Date.now() } = {}) => {
  const tokens = tokenize(f.q);
  const boost = Math.max(0, Number(maxPlanBoostPercent) || 0) / 100;
  const published = (c) => Date.parse(c.publishedAt || c.createdAt || 0) || 0;

  const scored = list.map((c) => {
    const rel = relevance(c, tokens, now, { trainedPriority });
    const level = PLAN_LEVEL[effectivePlan(c, now)] || 0;
    let score;
    switch (f.sort) {
      case 'recent': score = published(c); break;
      case 'prix_asc': score = -(c.salaryMin ?? Number.MAX_SAFE_INTEGER); break;
      case 'prix_desc': score = c.salaryMin ?? -1; break;
      case 'pertinence_pure': score = rel; break;
      default: score = rel * (1 + (boost * level) / MAX_PLAN_LEVEL);
    }
    return { c, score, published: published(c) };
  });

  scored.sort((a, b) => (b.score - a.score) || (b.published - a.published) || String(a.c.id).localeCompare(String(b.c.id)));
  return scored.map((x) => x.c);
};

module.exports = {
  parseSearchFilters, matchesFilters, sortCandidates, effectivePlan, keywordsOf, relevance, PLAN_LEVEL,
};
