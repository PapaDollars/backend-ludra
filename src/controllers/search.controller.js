const ApiResponse = require('../utils/ApiResponse');
const { AppError } = require('../utils/AppError');
const { cursorPage } = require('../utils/pagination');
const { normalize } = require('../utils/text');
const { searchOptions, CITIES, JOBS, SERVICE_CATEGORIES } = require('../config/referentials');
const { getSettings } = require('../services/settings.service');
const { getRecruiterPlan } = require('../services/recruiter.service');
const { findActiveCandidates, toCandidateFeedItem } = require('../services/candidates.service');
const { parseSearchFilters, sortCandidates } = require('../services/personnelRanking');

/**
 * Recherche (contrat V2.1, étape 2). Univers branché : `personnel` (M10).
 * `immobilier` et `services` : 501 tant que les collections V2.1 (annonces, prestataires) n'existent pas.
 */
const requirePersonnel = (f) => {
  if (!f.universe) throw new AppError('Paramètre universe requis (immobilier | personnel | services).', 400, 'VALIDATION_ERROR');
  if (f.universe !== 'personnel') {
    throw new AppError(`La recherche « ${f.universe} » n'est pas encore disponible.`, 501, 'NOT_IMPLEMENTED');
  }
};

const viewerOf = (req) => (req.user && req.user.isActive !== false ? req.user : null);

/** GET /search?universe=personnel&<filtres>&cursor=&limit= → `CursorPage<FeedItem>` (total inclus). */
exports.search = async (req, res) => {
  const f = parseSearchFilters(req.query);
  requirePersonnel(f);

  const viewer = viewerOf(req);
  const [list, settings, plan] = await Promise.all([
    findActiveCandidates(f),
    getSettings(),
    viewer ? getRecruiterPlan(viewer.id) : null,
  ]);
  const sorted = sortCandidates(list, f, {
    maxPlanBoostPercent: settings.ranking.maxPlanBoostPercent,
    trainedPriority: Boolean(plan && plan.rights.trainedPriority),
  });

  const page = cursorPage(sorted, req.query.cursor, req.query.limit || 20);
  return ApiResponse.success(res, { ...page, items: page.items.map((c) => toCandidateFeedItem(c)) });
};

/** GET /search/count?<filtres> → `{ total }` (aucun item renvoyé ; résultats en cache 60 s). */
exports.count = async (req, res) => {
  const f = parseSearchFilters(req.query);
  requirePersonnel(f);
  const list = await findActiveCandidates(f);
  return ApiResponse.success(res, { total: list.length });
};

/** GET /search/options → `SearchOptions`. */
exports.options = async (req, res) => ApiResponse.success(res, searchOptions());

/** GET /search/suggestions?q= → `SearchSuggestion[]` (q ≥ 2 caractères, 8 max). */
exports.suggestions = async (req, res) => {
  const n = normalize(typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '');
  if (n.length < 2) return ApiResponse.success(res, []);

  const out = [];
  CITIES.forEach((c) => {
    if (normalize(c.name).includes(n)) out.push({ kind: 'city', label: c.name, hint: 'Ville', filters: { city: c.name } });
    c.districts.forEach((d) => {
      if (normalize(d).includes(n)) out.push({ kind: 'district', label: d, hint: `Quartier · ${c.name}`, filters: { city: c.name, district: d } });
    });
  });
  JOBS.forEach((j) => {
    if (normalize(j.label).includes(n)) out.push({ kind: 'job', label: j.label, hint: 'Métier', filters: { universe: 'personnel', job: j.value } });
  });
  SERVICE_CATEGORIES.forEach((s) => {
    if (normalize(s.label).includes(n)) out.push({ kind: 'category', label: s.label, hint: 'Service', filters: { universe: 'services', category: s.value } });
  });
  return ApiResponse.success(res, out.slice(0, 8));
};
