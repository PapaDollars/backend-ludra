/**
 * Profils candidats de démonstration (placement du personnel), pour tester le module tant que la
 * publication « + Publier » (module 06, POST /drafts/:id/publish) n'existe pas.
 *
 *   node scripts/seed-demo-candidates.js            → simulation (aucune écriture)
 *   node scripts/seed-demo-candidates.js --apply    → crée / remplace les 5 profils `demo-c-00X`
 *   node scripts/seed-demo-candidates.js --remove   → supprime ces profils
 *
 * Identifiants préfixés `demo-` et champ `demo: true` : faciles à retrouver et à supprimer.
 * À NE PAS lancer sur la base de production sans le vouloir : les profils apparaîtraient dans la recherche.
 */
require('dotenv').config();
const { db } = require('../src/config/firebase');
const { keywordsOf } = require('../src/services/personnelRanking');

const apply = process.argv.includes('--apply');
const remove = process.argv.includes('--remove');
const DAY = 24 * 60 * 60 * 1000;
const ago = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const inDays = (d) => new Date(Date.now() + d * DAY).toISOString();

const person = (id, name, verified, city) => ({ id, name, avatar: null, kind: 'candidate', verified, city });

const PROFILES = [
  {
    id: 'demo-c-001', publisher: person('demo-u-clarisse', 'Clarisse N.', true, 'Yaoundé'),
    title: 'Chauffeure expérimentée — permis B', city: 'Yaoundé', district: null,
    job: 'Chauffeur', jobCode: 'chauffeur', experienceYears: 6, availability: 'immediate',
    salaryMin: 100000, salaryMax: 200000, plan: 'premium', planExpiresAt: inDays(20), trained: true,
    summary: 'Chauffeure expérimentée, bonne connaissance de Yaoundé, disponible pour entreprise ou famille. Profil complet et documents contrôlés.',
    skills: ['Conduite urbaine', 'Ponctuelle', 'Disponible'], training: 'Conduite défensive', license: 'B - valide',
    references: { total: 2, verified: 2 }, publishedAt: ago(1),
  },
  {
    id: 'demo-c-002', publisher: person('demo-u-jeanpaul', 'Jean-Paul M.', true, 'Douala'),
    title: 'Chauffeur poids léger, disponible', city: 'Douala', district: null,
    job: 'Chauffeur', jobCode: 'chauffeur', experienceYears: 4, availability: 'sous_15_jours',
    salaryMin: 70000, salaryMax: 90000, plan: 'standard', planExpiresAt: inDays(10), trained: false,
    summary: 'Chauffeur poids léger, trajets urbains et interurbains, entretien courant du véhicule.',
    skills: ['Interurbain', 'Entretien véhicule'], training: null, license: 'B - valide',
    references: { total: 1, verified: 0 }, publishedAt: ago(4),
  },
  {
    id: 'demo-c-003', publisher: person('demo-u-amina', 'Amina K.', true, 'Yaoundé'),
    title: 'Ménagère sérieuse, références contrôlées', city: 'Yaoundé', district: null,
    job: 'Ménagère', jobCode: 'menagere', experienceYears: 2, availability: 'immediate',
    salaryMin: 40000, salaryMax: 60000, plan: 'gratuit', planExpiresAt: null, trained: false,
    summary: 'Ménagère sérieuse et discrète, entretien de maison et repassage, références contrôlées.',
    skills: ['Repassage', 'Entretien', 'Discrétion'], training: null, license: null,
    references: { total: 2, verified: 1 }, publishedAt: ago(12),
  },
  {
    id: 'demo-c-004', publisher: person('demo-u-esther', 'Esther B.', true, 'Douala'),
    title: 'Cuisinière — cuisine camerounaise et européenne', city: 'Douala', district: 'Bonapriso',
    job: 'Cuisinier / cuisinière', jobCode: 'cuisinier', experienceYears: 9, availability: 'a_convenir',
    salaryMin: 90000, salaryMax: 130000, plan: 'standard', planExpiresAt: inDays(25), trained: true,
    summary: 'Cuisinière, neuf ans en famille et en restaurant. Cuisine camerounaise et européenne, gestion des courses.',
    skills: ['Cuisine camerounaise', 'Pâtisserie', 'Gestion des courses'], training: 'CAP cuisine', license: null,
    references: { total: 3, verified: 3 }, publishedAt: ago(14),
  },
  {
    id: 'demo-c-005', publisher: person('demo-u-marc', 'Marc A.', false, 'Yaoundé'),
    title: 'Auxiliaire de vie, accompagnement personnes âgées', city: 'Yaoundé', district: 'Mvan',
    job: 'Auxiliaire de vie', jobCode: 'auxiliaire_de_vie', experienceYears: 3, availability: 'immediate',
    salaryMin: 60000, salaryMax: 80000, plan: 'gratuit', planExpiresAt: null, trained: true,
    summary: 'Auxiliaire de vie, accompagnement de personnes âgées, aide aux repas et à la mobilité.',
    skills: ['Aide à la mobilité', 'Patience', 'Premiers secours'], training: 'Formation premiers secours', license: null,
    references: { total: 1, verified: 1 }, publishedAt: ago(18),
  },
];

const main = async () => {
  const mode = remove ? 'SUPPRESSION' : apply ? 'ÉCRITURE' : 'SIMULATION (ajouter --apply pour écrire)';
  console.log(`Profils de démo — ${mode}`);

  const batch = db.batch();
  PROFILES.forEach(({ id, ...p }) => {
    const ref = db.collection('candidates').doc(id);
    if (remove) {
      batch.delete(ref);
    } else {
      const doc = {
        ...p, userId: p.publisher.id, status: 'active', media: [], demo: true,
        createdAt: p.publishedAt, updatedAt: p.publishedAt,
      };
      doc.keywords = keywordsOf(doc);
      batch.set(ref, doc);
    }
    console.log(`  ${remove ? '−' : '+'} candidates/${id} — ${p.title}`);
  });

  if (apply || remove) {
    await batch.commit();
    console.log('Terminé.');
  }
};

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
