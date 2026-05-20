require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// ─── SÉCURITÉ ────────────────────────────────────────────────────────────────
app.use(helmet());

const buildAllowedOrigins = () => {
  const base = process.env.FRONTEND_URL || 'http://localhost:3000';
  const origins = new Set(['http://localhost:3000', 'http://localhost:3001', base]);
  // Ajouter automatiquement la version www / non-www
  if (base.includes('://www.')) origins.add(base.replace('://www.', '://'));
  else if (base.startsWith('https://')) origins.add(base.replace('https://', 'https://www.'));
  return origins;
};
const ALLOWED_ORIGINS = buildAllowedOrigins();

app.use(cors({
  origin: (origin, callback) => {
    // Requêtes server-to-server (NextAuth, Vercel → Scalingo) : pas d'origin → OK
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    console.warn('[CORS] Origine bloquée:', origin);
    callback(new Error(`CORS: origine non autorisée — ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting global
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: 'Trop de requêtes, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Rate limiting strict pour l'auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Trop de tentatives de connexion, réessayez dans 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── PARSING ──────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── LOGS ─────────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── DOCUMENTATION SWAGGER ───────────────────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Ludra API - Documentation',
}));

app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ─── HEALTHCHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Ludra API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// ─── ROUTES API ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl} — origine: ${req.headers.origin || 'inconnue'}`);
  res.status(404).json({ success: false, message: 'Service introuvable.' });
});

// ─── GESTIONNAIRE D'ERREURS GLOBAL ────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
