require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Ludra API démarrée`);
  console.log(`   Environnement : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Port          : ${PORT}`);
  console.log(`   API           : http://localhost:${PORT}/api`);
  console.log(`   Swagger       : http://localhost:${PORT}/api/docs`);
  console.log(`   Health        : http://localhost:${PORT}/health\n`);
});

process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err.message);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  console.log('SIGTERM reçu. Arrêt propre...');
  server.close(() => process.exit(0));
});
