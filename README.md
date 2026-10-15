# ludra-back

API Express + Firestore de LUDRA HOME. Contrat des endpoints attendus par le front : `frontend-ludra/docs/API_CONTRACT_V2.1.md`.

## Démarrage

```bash
npm install
npm run dev        # nodemon src/server.js
```

Documentation Swagger : `GET /api/docs` (JSON : `GET /api/docs.json`). Santé : `GET /health`.

## Routes montées (`src/routes/index.js`) — 19 endpoints

| Préfixe | Statut |
|---------|--------|
| `/api/auth/*` | V1 conservée : `POST /send-code`, `POST /register`, `POST /login`, `POST /refresh-token`, `POST /forgot-password`, `POST /reset-password`, `GET /me`, `POST /logout` |
| `/api/users/*` | V1 conservée : `PUT /profile`, `POST /profile/avatar`, `POST /request-deletion`, `POST /cancel-deletion` |
| `/api/contacts/general` | V1 conservée : `POST` (formulaire de la page Aide, public) |
| `/api/notifications` | V2.1 : `GET /` (`NotificationPage`), `POST /:id/read`, `POST /read-all` |
| `/api/admin/*` | V2.1 : `GET /stats`, `GET /users`, `PATCH /users/:id` — les autres endpoints back-office sont à ajouter |

Les routes V1 `/properties`, `/favorites`, `/visits`, `/landlord`, les demandes de contact et les anciennes routes admin ont été supprimées (2026-10-15) : le front V2.1 ne les utilise plus.

## Utilitaires pour les endpoints V2.1

- `utils/pagination.js` : `cursorPage(liste, cursor, limit)` → `{ items, nextCursor, total }`
- `utils/audit.js` : `createAuditEntry(req.user, { action, targetType, targetId, targetLabel, reason?, changes? })` (collection `auditLog`)
- `utils/notifications.js` : `createNotification(userId, { kind, title, body, href })`, `notifierTousLesAdmins(...)`

## Migrations de données (`scripts/`)

| Script | État |
|--------|------|
| `migrate-adminlogs-to-auditlog.js` | ✅ appliqué le 2026-10-15 : 22 entrées `adminLogs` → `auditLog` (ids `legacy-<id>`, champ `legacy` pour la traçabilité). Idempotent ; simulation sans `--apply`. `adminLogs` conservée (supprimable après vérification). |
| `properties` (61), `contacts` (12), `visits` (1) | ⏳ à migrer quand les collections V2.1 (annonces, messagerie) seront définies — **ne pas supprimer avant**. |
