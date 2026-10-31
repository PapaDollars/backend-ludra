/**
 * Référentiels de recherche (`SearchOptions`, contrat V2.1 étape 2).
 * Mêmes codes que le front (src/mocks/search.mock.ts). Ils deviendront administrables (M16) :
 * les servir via services/settings.service.js le moment venu.
 */
const CITIES = [
  { name: 'Yaoundé', districts: ['Bastos', 'Biyem-Assi', 'Essos', 'Mvan', 'Odza', 'Omnisport'] },
  { name: 'Douala', districts: ['Akwa', 'Bonamoussadi', 'Bonapriso', 'Lendi', 'Logpom', 'Makepe'] },
];

const PROPERTY_KINDS = [
  { value: 'appartement', label: 'Appartement' },
  { value: 'studio', label: 'Studio' },
  { value: 'chambre', label: 'Chambre' },
  { value: 'maison', label: 'Maison' },
  { value: 'villa', label: 'Villa' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'bureau', label: 'Bureau' },
  { value: 'commerce', label: 'Local commercial' },
];

const AMENITIES = [
  { value: 'meuble', label: 'Meublé' },
  { value: 'parking', label: 'Parking' },
  { value: 'eau_24_7', label: 'Eau 24/7' },
  { value: 'jardin', label: 'Jardin' },
  { value: 'groupe_electrogene', label: 'Groupe électrogène' },
];

/** Métiers du placement du personnel (`jobCode` des profils candidats). */
const JOBS = [
  { value: 'chauffeur', label: 'Chauffeur' },
  { value: 'menagere', label: 'Ménagère' },
  { value: 'cuisinier', label: 'Cuisinier / cuisinière' },
  { value: 'auxiliaire_de_vie', label: 'Auxiliaire de vie' },
];

const SERVICE_CATEGORIES = [
  { value: 'demenagement', label: 'Déménagement' },
  { value: 'plomberie', label: 'Plomberie' },
  { value: 'electricite', label: 'Électricité' },
  { value: 'peinture', label: 'Peinture' },
  { value: 'menage', label: 'Ménage' },
  { value: 'gardiennage', label: 'Gardiennage' },
  { value: 'travaux', label: 'Travaux' },
  { value: 'professionnels_habilites', label: 'Professionnels habilités' },
];

const AVAILABILITIES = ['immediate', 'sous_15_jours', 'a_convenir'];

const searchOptions = () => ({
  cities: CITIES,
  propertyKinds: PROPERTY_KINDS,
  amenities: AMENITIES,
  jobs: JOBS,
  serviceCategories: SERVICE_CATEGORIES,
});

module.exports = { CITIES, PROPERTY_KINDS, AMENITIES, JOBS, SERVICE_CATEGORIES, AVAILABILITIES, searchOptions };
