const ApiResponse = require('../utils/ApiResponse');
const { notFound, validationError } = require('../utils/AppError');
const { getCandidate, toCandidateFeedItem, toCandidateDetail } = require('../services/candidates.service');
const recruiter = require('../services/recruiter.service');

/** Placement du personnel : profils candidats (M11), accès recruteur et shortlist (M13). */

const viewerOf = (req) => (req.user && req.user.isActive !== false ? req.user : null);

/** Droits du visiteur sur un profil (`CandidateViewerAccess`), calculés côté serveur. */
const viewerAccessFor = async (viewer, candidateId) => {
  if (!viewer) return { canContact: false, canShortlist: false, shortlisted: false, reason: 'login' };
  const plan = await recruiter.getRecruiterPlan(viewer.id);
  const shortlisted = plan.rights.shortlist
    ? (await recruiter.getShortlistEntries(viewer.id)).some((e) => e.candidateId === candidateId)
    : false;
  const access = { canContact: plan.rights.contact, canShortlist: plan.rights.shortlist, shortlisted };
  if (!plan.planCode) access.reason = 'no_plan';
  else if (!plan.rights.contact || !plan.rights.shortlist) access.reason = 'plan_too_low';
  return access;
};

/** GET /candidates/:id — public (token optionnel) → `CandidateDetail`. 404 si inconnu ou masqué. */
exports.getCandidate = async (req, res) => {
  const viewer = viewerOf(req);
  const c = await getCandidate(req.params.id);
  const viewerIsOwner = Boolean(viewer && c && c.userId === viewer.id);
  if (!c || (c.status !== 'active' && !viewerIsOwner)) throw notFound('Profil introuvable');

  const viewerAccess = await viewerAccessFor(viewer, c.id);
  return ApiResponse.success(res, toCandidateDetail(c, { viewerAccess, viewerIsOwner }));
};

/** GET /me/candidate-profile — auth → mon profil (`CandidateFeedItem`) ou null. */
exports.getMyCandidateProfile = async (req, res) => {
  const c = await getCandidate(req.user.id);
  return ApiResponse.success(res, c ? toCandidateFeedItem(c) : null);
};

/** GET /recruiter/access — auth → `RecruiterAccess`. */
exports.getAccess = async (req, res) => ApiResponse.success(res, await recruiter.getRecruiterAccess(req.user.id));

/** GET /recruiter/shortlist — droit `shortlist` → `ShortlistEntry[]`. */
exports.getShortlist = async (req, res) => ApiResponse.success(res, await recruiter.getShortlist(req.user.id));

/** POST /recruiter/shortlist { candidateId } — idempotent → `ShortlistEntry[]`. */
exports.addToShortlist = async (req, res) => {
  const { candidateId } = req.body || {};
  if (typeof candidateId !== 'string' || !candidateId || candidateId.length > 128 || candidateId.includes('/')) {
    throw validationError([{ field: 'candidateId', message: 'Profil invalide.' }]);
  }
  return ApiResponse.success(res, await recruiter.addToShortlist(req.user.id, candidateId), 'Ajouté à la shortlist');
};

/** DELETE /recruiter/shortlist/:candidateId → `ShortlistEntry[]`. */
exports.removeFromShortlist = async (req, res) =>
  ApiResponse.success(res, await recruiter.removeFromShortlist(req.user.id, req.params.candidateId), 'Retiré de la shortlist');

/** GET /recruiter/shortlist/export — droit `exportShortlist` → fichier CSV. */
exports.exportShortlist = async (req, res) => {
  const csv = await recruiter.exportShortlistCsv(req.user.id);
  const date = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="shortlist-${date}.csv"`,
    'Cache-Control': 'no-store',
  });
  return res.send(csv);
};
