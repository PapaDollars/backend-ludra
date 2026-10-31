/**
 * Plans par défaut (contrat V2.1, étapes 6 et 8). Prix, avantages, durée et activation sont
 * surchargeables par le back-office : document Firestore `settings/app` (services/settings.service.js).
 *
 * À confirmer par le métier : durée des plans candidats et forfaits recruteurs (30 jours par défaut).
 */
const DEFAULT_PLANS = [
  // ── Propriétaires / agents (M08) ──
  {
    code: 'oa_verifie', audience: 'owner_agent', name: 'Vérifié', price: 5000, period: 'month', durationDays: 30, recommended: false, tone: 'trust', rank: 1,
    features: ['Badge identité vérifiée', 'Profil public rassurant', 'Messagerie & avis'],
  },
  {
    code: 'oa_pro', audience: 'owner_agent', name: 'Pro', price: 10000, period: 'month', durationDays: 30, recommended: true, tone: 'brand', rank: 2,
    features: ['Tout Vérifié', 'Mise en avant périodique', 'Statistiques avancées', 'Priorité dans les résultats'],
  },
  {
    code: 'oa_premium', audience: 'owner_agent', name: 'Premium', price: 15000, period: 'month', durationDays: 30, recommended: false, tone: 'perso', rank: 3,
    features: ['Tout Pro', 'Plus de boosts sponsorisés', 'Support prioritaire', 'Rapport performance + reporting'],
  },
  // ── Candidats (M12) : le profil reste gratuit ; un plan change le classement, jamais les compétences ni les badges ──
  {
    code: 'cand_gratuit', audience: 'candidate', name: 'Gratuit', price: 0, period: 'pass', durationDays: 0, recommended: false, tone: 'trust', rank: 0,
    features: ['Profil créé gratuitement', 'Visibilité organique', 'Messagerie interne'],
  },
  {
    code: 'cand_standard', audience: 'candidate', name: 'Standard', price: 500, period: 'pass', durationDays: 30, recommended: false, tone: 'brand', rank: 1,
    features: ['Priorité modérée', 'Ciblage postes ~50–80k', 'Badge Standard'],
  },
  {
    code: 'cand_premium', audience: 'candidate', name: 'Premium', price: 1000, period: 'pass', durationDays: 30, recommended: true, tone: 'perso', rank: 2,
    features: ['Priorité la plus forte', 'Ciblage postes ~100–200k+', 'Badge Premium + stats'],
  },
  // ── Recruteurs (M13) ──
  {
    code: 'rec_essentiel', audience: 'recruiter', name: 'Essentiel', price: 5000, period: 'pass', durationDays: 30, recommended: false, tone: 'brand', rank: 1,
    features: ['Accès aux meilleurs profils', 'Filtres avancés', 'Shortlist de candidats'],
  },
  {
    code: 'rec_forme', audience: 'recruiter', name: 'Formé', price: 8000, period: 'pass', durationDays: 30, recommended: true, tone: 'trust', rank: 2,
    features: ['Tout Essentiel', 'Priorité aux profils formés', 'Badges de formation vérifiée', 'Export shortlist'],
  },
  {
    code: 'rec_premium', audience: 'recruiter', name: 'Premium', price: 10000, period: 'pass', durationDays: 30, recommended: false, tone: 'perso', rank: 3,
    features: ['Tout Formé', 'Présélection assistée', 'Profils premium en tête', 'Support prioritaire'],
  },
];

const PLAN_AUDIENCES = ['owner_agent', 'candidate', 'recruiter'];

/** Droits ouverts par chaque forfait recruteur (`RecruiterRights`, contrat V2.1 étape 8). */
const NO_RECRUITER_RIGHTS = Object.freeze({
  contact: false, advancedFilters: false, shortlist: false, trainedPriority: false,
  exportShortlist: false, assistedPreselection: false, prioritySupport: false,
});

const DEFAULT_RECRUITER_RIGHTS = {
  rec_essentiel: { ...NO_RECRUITER_RIGHTS, contact: true, advancedFilters: true, shortlist: true },
  rec_forme: { ...NO_RECRUITER_RIGHTS, contact: true, advancedFilters: true, shortlist: true, trainedPriority: true, exportShortlist: true },
  rec_premium: {
    contact: true, advancedFilters: true, shortlist: true, trainedPriority: true,
    exportShortlist: true, assistedPreselection: true, prioritySupport: true,
  },
};

/** Plan candidat → niveau de visibilité du profil (`CandidateFeedItem.plan`). */
const CANDIDATE_PLAN_LEVEL = { cand_gratuit: 'gratuit', cand_standard: 'standard', cand_premium: 'premium' };

module.exports = {
  DEFAULT_PLANS, PLAN_AUDIENCES, NO_RECRUITER_RIGHTS, DEFAULT_RECRUITER_RIGHTS, CANDIDATE_PLAN_LEVEL,
};
