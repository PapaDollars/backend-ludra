const admin = require('firebase-admin');

const REQUIRED_VARS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_CLIENT_ID',
];

const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  FIREBASE : variables d\'environnement manquantes         ║');
  console.error('╠══════════════════════════════════════════════════════════╣');
  missing.forEach((v) => console.error(`║  ❌ ${v.padEnd(54)}║`));
  console.error('╠══════════════════════════════════════════════════════════╣');
  console.error('║  → Sur Railway : Settings > Variables > Add Variable     ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
  process.exit(1);
}

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

module.exports = { admin, db };
