# ludra-back

API Express + Firestore de LUDRA HOME. Contrat des endpoints attendus par le front : `frontend-ludra/docs/API_CONTRACT_V2.1.md`.

**Pour démarrer sur la V2.1 : lire [`docs/GUIDE_BACKEND_V2.1.md`](docs/GUIDE_BACKEND_V2.1.md)** (fonctionnement du front, liste à cocher, tâches à ne pas oublier).

## Démarrage

```bash
npm install
npm run dev        # nodemon src/server.js
```

Documentation Swagger : `GET /api/docs` (JSON : `GET /api/docs.json`). Santé : `GET /health`.

## Routes montées (`src/routes/index.js`) — 42 endpoints

| Préfixe | Statut |
|---------|--------|
| `/api/auth/*` | V1 conservée : `POST /send-code`, `POST /register`, `POST /login`, `POST /refresh-token`, `POST /forgot-password`, `POST /reset-password`, `GET /me`, `POST /logout` |
| `/api/users/*` | V1 conservée : `PUT /profile`, `POST /profile/avatar`, `POST /request-deletion`, `POST /cancel-deletion` |
| `/api/contacts/general` | V1 conservée : `POST` (formulaire de la page Aide, public) |
| `/api/notifications` | V2.1 : `GET /` (`NotificationPage`), `POST /:id/read`, `POST /read-all` |
| `/api/admin/*` | V2.1 : `GET /stats`, `GET /users`, `PATCH /users/:id`, `GET /proofs`, `POST /proofs/:id/decision` — les autres endpoints back-office sont à ajouter |
| `/api/search/*` | V2.1 : `GET /` et `GET /count` (**univers `personnel` uniquement** ; `immobilier` / `services` → `501 NOT_IMPLEMENTED`), `GET /options`, `GET /suggestions` |
| `/api/candidates/:id`, `/api/me/candidate-profile` | V2.1 placement du personnel (M10–M11) |
| `/api/recruiter/*` | V2.1 (M13) : `GET /access`, `GET` / `POST /shortlist`, `DELETE /shortlist/:candidateId`, `GET /shortlist/export` (CSV) |
| `/api/plans`, `/api/subscriptions/me`, `/api/payments/*` | V2.1 (M08, M12, M13) : `GET /plans?audience=`, `GET /subscriptions/me`, `POST /payments/subscription`, `GET /payments/:id` |
| `/api/drafts/*`, `/api/uploads` | V2.1 publication « + Publier » (M06) : `GET` / `POST /drafts`, `GET` / `PATCH` / `DELETE /drafts/:id`, `POST /drafts/:id/publish` (**univers `personnel` uniquement** ; `immobilier` / `services` → `501 NOT_IMPLEMENTED`, brouillon conservé), `POST /uploads` (image ≤ 10 Mo → Cloudinary `ludra/publications`) |

## Placement du personnel (modules 10 à 13)

| Fichier | Rôle |
|---------|------|
| `services/candidates.service.js` | Profils (`candidates/{userId}`), formes `CandidateFeedItem` / `CandidateDetail`, recherche, `publishCandidateProfile()` |
| `services/personnelRanking.js` | Filtres et classement (module pur) : pertinence + bonus de plan borné (`maxPlanBoostPercent`, 20 % par défaut) ; `pertinence_pure` sans effet des plans |
| `services/recruiter.service.js` | Droits du forfait recruteur, shortlist (`shortlists/{userId}`), export CSV, `canContactCandidates()` |
| `services/subscriptions.service.js` | Abonnements (`subscriptions/{userId}_{audience}`, un seul actif par audience, expiration calculée à la lecture) |
| `services/payments.service.js`, `services/mobileMoney.js` | Paiements Mobile Money (`payments`), idempotence, activation de l'abonnement au statut `paid` |
| `services/settings.service.js`, `config/plans.js` | Plans et droits par défaut, surchargeables par `settings/app` (cache 5 min) |
| `config/referentials.js` | Villes, métiers, catégories (`GET /search/options`) |

**Reste à brancher** (modules non encore implémentés) :

- **Création des profils** : via « + Publier » (`POST /drafts/:id/publish`, `services/drafts.service.js`). Profils de démo pour tester : `node scripts/seed-demo-candidates.js --apply` (5 profils `demo-c-00X`, suppression avec `--remove`).
- **Contact d'un candidat** : `POST /conversations/open` (module 05, à créer) doit refuser avec `403 PLAN_REQUIRED` si `canContactCandidates(recruteur)` est faux, sauf si le candidat a initié l'échange.
- **Paiements réels** : `PAYMENT_PROVIDER=simulation` (défaut hors production : `paid` après ~6 s, numéro finissant par `0000` = échec). En production, aucun fournisseur n'est branché → `503 PAYMENT_UNAVAILABLE`. Ajouter le fournisseur choisi dans `services/mobileMoney.js` et un webhook signé qui appelle `settlePayment()`.
- **Favoris** (`isFavorite`) toujours `false` tant que `/saved` n'existe pas ; badge « Identité vérifiée » = `kycStatus === 'verifie'` recopié à la publication, en attendant le module KYC.
- **Preuves « Formé »** : une preuve `training` est créée automatiquement quand un profil est publié avec une formation ; le candidat ne peut pas encore joindre de document justificatif (pas d'endpoint côté front).

## Publication « + Publier » (module 06)

- `services/drafts.service.js` : brouillons (`drafts/{id}`, 30 maximum par utilisateur). La sauvegarde automatique n'applique aucune validation métier : champs inconnus ou mal typés ignorés, textes tronqués à ≈ 2 × la limite. `sourceItemId` et `onBehalfOf` ne sont jamais acceptés du client en `PATCH` ; `onBehalfOf` à la création exige `add_property` (nom relu côté serveur) et la publication est journalisée (`publication.on_behalf`).
- `POST /uploads` enregistre chaque image dans `uploads/{id}` ; à la publication, chaque photo du brouillon doit appartenir à son auteur.
- Publication `personnel` → `publishCandidateProfile()` (profil créé ou mis à jour, `published`, ou `pending_review` si le profil est suspendu par la modération).
- **À faire** : publication `immobilier` (collection annonces V2.1, fiche `/listings/:id`, modération, migration des 61 `properties`) et `services` (prestataires) ; nettoyage des images téléversées jamais publiées (`uploads` sans brouillon).

Les routes V1 `/properties`, `/favorites`, `/visits`, `/landlord`, les demandes de contact et les anciennes routes admin ont été supprimées (2026-10-15) : le front V2.1 ne les utilise plus.

## Quota Firestore (forfait Spark)

- `utils/userCache.js` : cache mémoire des utilisateurs (60 s par utilisateur pour l'authentification, 2 min pour la liste du back-office). **Toute écriture sur `users/{id}` doit appeler `invalidateUser(id)`.** Prévu pour une seule instance ; avec plusieurs instances, réduire les durées.
- `firestore.indexes.json` : index composites (notifications paginées, preuves par statut, brouillons par utilisateur). La recherche de candidats n'utilise que des égalités (fusion des index simples, pas d'index composite) et met les résultats en cache 60 s par combinaison de filtres. À créer avant ou juste après le déploiement : `firebase deploy --only firestore:indexes` (ou console Firebase → Firestore → Index). Sans l'index, `GET /notifications` fonctionne quand même (lecture complète, message d'avertissement dans les logs).
- Règles pour les prochains endpoints : `frontend-ludra/docs/API_CONTRACT_V2.1.md`, section « Règles de coût Firestore ».

## Utilitaires pour les endpoints V2.1

- `utils/pagination.js` : `cursorPage(liste, cursor, limit)` → `{ items, nextCursor, total }`
- `utils/audit.js` : `createAuditEntry(req.user, { action, targetType, targetId, targetLabel, reason?, changes? })` (collection `auditLog`)
- `utils/notifications.js` : `createNotification(userId, { kind, title, body, href })`, `notifierTousLesAdmins(...)`

## Migrations de données (`scripts/`)

| Script | État |
|--------|------|
| `migrate-adminlogs-to-auditlog.js` | ✅ appliqué le 2026-10-15 : 22 entrées `adminLogs` → `auditLog` (ids `legacy-<id>`, champ `legacy` pour la traçabilité). Idempotent ; simulation sans `--apply`. `adminLogs` conservée (supprimable après vérification). |
| `properties` (61), `contacts` (12), `visits` (1) | ⏳ à migrer quand les collections V2.1 (annonces, messagerie) seront définies — **ne pas supprimer avant**. |
