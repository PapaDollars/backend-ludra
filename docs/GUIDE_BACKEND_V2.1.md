# LUDRA HOME V2.1 — Guide

Mis à jour le 1er novembre 2026.

Ce guide explique comment fonctionne le front V2.1, ce qui reste à construire et ce qu'il ne faut pas oublier. Il sert de feuille de route. Le détail des champs et des réponses est dans le contrat API.

| Document | Rôle | Emplacement |
|----------|------|-------------|
| **Ce guide** | Vue d'ensemble, ordre de travail, liste à cocher, pièges | `backend-ludra/docs/` |
| **Contrat API** | Forme exacte de chaque requête et réponse | [`docs/API_CONTRACT_V2.1.md`](https://github.com/PapaDollars/frontend-ludra/blob/main/docs/API_CONTRACT_V2.1.md) (dépôt front) |
| **Types TypeScript** | Référence en cas de doute | `src/types/` (dépôt front) |
| **Mocks** | Exemples réalistes et règles métier simulées | `src/mocks/` (dépôt front) |

En cas de contradiction : les types priment sur le contrat, et le contrat prime sur ce guide.

## 1. La situation en bref

LUDRA n'est plus seulement un site d'annonces de logement. C'est maintenant un feed avec **trois univers** : immobilier, personnel (candidats et recruteurs) et services. Le site comprend aussi une messagerie, le déblocage payant du contact, la certification KYC, des abonnements, des avis et un back-office complet.

- **Le front est terminé**, mais il tourne sur des données de démo (mocks), sauf pour l'authentification.
- **110 endpoints** sont attendus : **19 sont en place**, **91 sont à créer**.
- **Des traitements ne sont visibles dans aucun appel du front** : webhook de paiement, tâches planifiées, notifications. Voir la [section 6](#6-ce-que-le-front-ne-révèle-pas).
- **Plusieurs décisions métier restent ouvertes**. Voir la [section 8](#8-décisions-à-prendre-avant-de-coder).

Pile backend : Express + Firestore (forfait gratuit Spark) + Cloudinary + Brevo, hébergé sur Render. Le front n'a pas de SDK Firebase : **tout passe par cette API**.

## 2. Comment le front parle à l'API

**Base.** `NEXT_PUBLIC_API_URL` doit inclure `/api`, par exemple `https://backend-ludra.onrender.com/api`. Aucun préfixe de version : les routes sont `/api/feed`, pas `/api/v2/feed`.

**Enveloppe de réponse.**

```json
{ "success": true, "data": {}, "message": "optionnel" }
{ "success": false, "message": "Texte affiché à l'utilisateur", "code": "OPTIONNEL", "errors": [{ "field": "price", "message": "Indiquez le prix." }] }
```

**Le `message` d'erreur est affiché tel quel** : écrivez-le en français, pour l'utilisateur. Quand `errors` est présent, ses messages remplacent `message`.

**Listes.** Le format est `{ items, nextCursor, total? }` (`CursorPage<T>`). `nextCursor: null` signifie fin de liste. Le curseur est opaque pour le front.

**Authentification.**

1. La connexion passe par NextAuth, **côté serveur Vercel**, qui appelle `POST /auth/login`. L'adresse IP vue par le backend est donc celle de Vercel, pas celle du visiteur.
2. Le front envoie ensuite `Authorization: Bearer <accessToken>`.
3. Sur une réponse `401`, il appelle `POST /auth/refresh-token` avec `{ refreshToken }`, rejoue la requête une fois, puis déconnecte l'utilisateur.
4. Une réponse `403` avec `code: "ACCOUNT_DISABLED"` déconnecte l'utilisateur.
5. `GET /auth/me` doit renvoyer au minimum : `id, name, email, phone, whatsapp, city, avatar, role, adminPermissions, emailVerified, phoneVerified, deletionRequestedAt`.

Routes « publiques » : le token est facultatif, mais s'il est présent la réponse est personnalisée (`isFavorite`, `viewerIsOwner`, `viewerAccess`…).

**Appels répétés.** Ces appels déterminent la charge réelle. Ils s'arrêtent quand l'onglet est masqué, sauf le suivi d'un paiement.

| Quoi | Fréquence | Appels |
|------|-----------|--------|
| Conversation ouverte | Toutes les 4 s | `GET /conversations/:id/messages?after=` + `GET /conversations/:id` |
| Liste des conversations | Toutes les 15 s | `GET /conversations` |
| Badges du header | Toutes les 30 s et à chaque changement de page | `GET /me/counters` |
| Dossier KYC en revue | Toutes les 5 s | `GET /kyc` |
| Paiement en attente | Toutes les 3 s, 2 min maximum | `GET /payments/:id` |
| Sauvegarde d'un brouillon | ~1,2 s après une modification | `PATCH /drafts/:id` |
| Compteur de la recherche | 300 ms après un changement de filtre | `GET /search/count` |

## 3. Tester avec le front

```bash
# Dans frontend-ludra/.env.local, puis redémarrer le front
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_USE_MOCKS=false
```

**Attention :** cette bascule est **globale**. À `false`, tous les écrans appellent la vraie API, y compris ceux dont l'endpoint n'existe pas encore.

Pour brancher un seul service, remplacez `withMock(mock, réel)` par l'appel réel dans `src/services/<module>.service.ts`, sur une branche de test. Chaque appel a cette forme :

```ts
return withMock(
  () => mockGetFeed(params),                     // données de démo
  async () => (await api.get('/feed')).data,     // appel réel
);
```

Les fichiers de `src/mocks/` montrent la réponse attendue et les règles simulées. Les données de démo restent dans le `localStorage` du navigateur.

## 4. Pages du front et lots de travail

| Pages du front | Lots |
|----------------|------|
| `/`, `/immobilier` | C |
| `/recherche` | A, C, G |
| `/annonces/:id` | C, E, H |
| `/messages`, `/messages/:id` | D |
| `/publier` | B |
| `/personnel`, `/personnel/candidats/:id`, `/personnel/abonnements`, `/personnel/forfaits`, `/personnel/shortlist` | C, E, I |
| `/services`, `/services/:categorie`, `/services/prestataires/:id` | A, C |
| `/avis/:userId`, `/compte/avis` | H |
| `/notifications` | Fait |
| `/compte`, `/compte/parametres` | J |
| `/compte/annonces` | B |
| `/compte/favoris` | G |
| `/compte/paiements`, `/compte/paiements/recu/:id`, `/compte/abonnements` | E |
| `/compte/certification` | F |
| `/admin/*` | A, K |
| `/auth/*`, `/aide`, `/a-propos` | Fait |

## 5. Liste à cocher

L'ordre proposé suit les dépendances : le feed a besoin d'annonces, les avis ont besoin de conversations et de paiements, le back-office a besoin de tout le reste. « Étape N » renvoie à la section du contrat API.

### Socle — fait (19)

- [x] `POST /auth/send-code`
- [x] `POST /auth/register`
- [x] `POST /auth/login`
- [x] `POST /auth/refresh-token`
- [x] `POST /auth/forgot-password`
- [x] `POST /auth/reset-password`
- [x] `GET /auth/me`
- [x] `POST /auth/logout`
- [x] `PUT /users/profile`
- [x] `POST /users/profile/avatar`
- [x] `POST /users/request-deletion`
- [x] `POST /users/cancel-deletion`
- [x] `POST /contacts/general`
- [x] `GET /notifications`
- [x] `POST /notifications/:id/read`
- [x] `POST /notifications/read-all`
- [x] `GET /admin/stats` (compteurs partiels, voir [section 7](#7-à-corriger-dans-le-backend-existant))
- [x] `GET /admin/users`
- [x] `PATCH /admin/users/:id`

### Lot A — Référentiels et paramètres (5) · étapes 2, 6, 9, 11

À faire en premier : prix, villes, métiers et catégories ne sont pas codés en dur dans le front.

- [ ] `GET /search/options`
- [ ] `GET /plans` (9 plans, à créer à l'identique : `src/mocks/subscription.mock.ts`)
- [ ] `GET /services/categories`
- [ ] `GET /admin/settings`
- [ ] `PUT /admin/settings` (journalisé ; effet immédiat sur les prix et les catégories)

### Lot B — Publication (10) · étapes 5, 10

- [ ] `GET /drafts`
- [ ] `POST /drafts`
- [ ] `GET /drafts/:id`
- [ ] `PATCH /drafts/:id` (aucune validation bloquante)
- [ ] `DELETE /drafts/:id`
- [ ] `POST /drafts/:id/publish` (validation complète ; `sourceItemId` met à jour la publication existante)
- [ ] `POST /uploads`
- [ ] `GET /me/items`
- [ ] `PATCH /me/items/:id/status`
- [ ] `POST /me/items/:id/edit`

### Lot C — Feed, recherche et fiches (10) · étapes 1, 2, 3, 8, 9

- [ ] `GET /feed`
- [ ] `GET /feed/suggested-accounts`
- [ ] `GET /me/counters`
- [ ] `GET /search` (`total` obligatoire ; inclut `universe=personnel` et `universe=services`)
- [ ] `GET /search/count`
- [ ] `GET /search/suggestions`
- [ ] `GET /listings/:id` (jamais de téléphone avant paiement)
- [ ] `GET /candidates/:id`
- [ ] `GET /services/providers/:id`
- [ ] `POST /saved/toggle`

### Lot D — Messagerie (8) · étape 4

- [ ] `GET /conversations`
- [ ] `POST /conversations/open`
- [ ] `GET /conversations/:id`
- [ ] `GET /conversations/:id/messages` (paramètres `before` et `after`)
- [ ] `POST /conversations/:id/messages` (multipart ; masquer coordonnées et liens)
- [ ] `POST /conversations/:id/read`
- [ ] `POST /conversations/:id/block`
- [ ] `DELETE /conversations/:id/block`

### Lot E — Paiements et abonnements (8) · étapes 3, 6, 10

- [ ] `POST /payments/unlock-contact` (header `Idempotency-Key`, pas de double débit)
- [ ] `POST /payments/subscription` (header `Idempotency-Key`)
- [ ] `GET /payments/:id`
- [ ] `GET /listings/:id/contact` (`402` si non payé)
- [ ] `GET /subscriptions/me`
- [ ] `GET /me/payments`
- [ ] `GET /me/payments/:id`
- [ ] `GET /me/unlocks`
- [ ] Webhook de l'opérateur (hors décompte, voir [section 6](#6-ce-que-le-front-ne-révèle-pas))

### Lot F — Certification KYC (6) · étape 6

- [ ] `GET /kyc`
- [ ] `PUT /kyc/profile`
- [ ] `POST /kyc/documents` (stockage privé, jamais d'URL renvoyée)
- [ ] `DELETE /kyc/documents/:id`
- [ ] `PUT /kyc/locations`
- [ ] `POST /kyc/submit`

### Lot G — Favoris et recherches sauvegardées (10) · étapes 2, 10

- [ ] `GET /saved`
- [ ] `PATCH /saved/:itemId`
- [ ] `GET /saved/collections`
- [ ] `POST /saved/collections`
- [ ] `PATCH /saved/collections/:id`
- [ ] `DELETE /saved/collections/:id`
- [ ] `GET /saved-searches`
- [ ] `POST /saved-searches`
- [ ] `PATCH /saved-searches/:id`
- [ ] `DELETE /saved-searches/:id`

### Lot H — Avis et signalements (7) · étapes 3, 7

- [ ] `GET /users/:userId/reviews`
- [ ] `GET /me/reviews/received`
- [ ] `GET /reviews/eligibility`
- [ ] `POST /reviews`
- [ ] `PATCH /reviews/:id`
- [ ] `POST /reviews/:id/reply`
- [ ] `POST /reports`

### Lot I — Personnel, côté recruteur et candidat (6) · étape 8

- [ ] `GET /me/candidate-profile`
- [ ] `GET /recruiter/access`
- [ ] `GET /recruiter/shortlist`
- [ ] `POST /recruiter/shortlist`
- [ ] `DELETE /recruiter/shortlist/:candidateId`
- [ ] `GET /recruiter/shortlist/export` (fichier CSV, aucune coordonnée)

### Lot J — Mon compte (5) · étape 10

- [ ] `GET /me/overview`
- [ ] `GET /me/preferences`
- [ ] `PUT /me/preferences`
- [ ] `POST /me/password`
- [ ] `POST /me/logout-all`

### Lot K — Back-office (16) · étape 11

Chaque décision écrit une entrée d'audit avec `createAuditEntry`. Un motif d'au moins 5 caractères est obligatoire pour toute décision négative (sinon `422`).

- [ ] `GET /admin/queue`
- [ ] `GET /admin/kyc`
- [ ] `GET /admin/kyc/:userId`
- [ ] `GET /admin/kyc/:userId/documents/:docId/view` (URL signée, 5 min maximum, consultation journalisée)
- [ ] `POST /admin/kyc/:userId/decision`
- [ ] `GET /admin/listings`
- [ ] `POST /admin/listings/:id/decision`
- [ ] `GET /admin/reviews`
- [ ] `POST /admin/reviews/:id/decision`
- [ ] `GET /admin/reports`
- [ ] `POST /admin/reports/:id/decision`
- [ ] `GET /admin/payments`
- [ ] `POST /admin/payments/:id/reconcile`
- [ ] `GET /admin/proofs`
- [ ] `POST /admin/proofs/:id/decision`
- [ ] `GET /admin/audit`

## 6. Ce que le front ne révèle pas

Ces traitements n'apparaissent dans aucun appel du front. Le site peut sembler complet alors qu'ils manquent.

### Webhook Mobile Money

Le contrat ne définit pas cette route, car c'est l'opérateur qui l'appelle.

- Vérifier la signature de chaque appel.
- Un paiement ne passe à `paid` **que** par ce webhook. Le retour de la demande de paiement ne suffit jamais.
- Traiter sans effet un webhook reçu deux fois.
- Après `paid`, selon le paiement : débloquer le contact ou activer l'abonnement, créer le numéro de reçu séquentiel, notifier l'utilisateur.
- Sur échec ou expiration : renseigner `failureReason`.
- Le serveur doit rester joignable en permanence : l'offre gratuite de Render se met en veille.

### Tâches planifiées

| Tâche | Effet attendu |
|-------|---------------|
| Suppression de compte | Supprimer les comptes dont `deletionScheduledAt` est dépassé. **Le site promet 72 h et aucun code ne le fait aujourd'hui.** Conserver les reçus (obligation légale). |
| Expiration des abonnements | Passer à `expired`, retirer les droits recruteur et le bonus de classement, remettre le plan candidat à gratuit. |
| Rappel d'expiration | Notification `subscription` avant l'échéance d'un plan. |
| Expiration KYC | Passer à `expire`, retirer le badge, mettre à jour `kycStatus`. |
| Paiements sans réponse | Passer à `expired` les paiements `pending` trop anciens. |
| Alertes de recherche | Calculer `newResults`, notifier si `alertEnabled`. |
| Rétention des conversations | Purger selon la politique retenue (à définir). |

Un `setInterval` dans le serveur n'est pas fiable si Render met l'instance en veille. Prévoyez un déclencheur externe qui appelle une route protégée par un secret.

### Effets de bord par événement

| Événement | À faire côté serveur |
|-----------|----------------------|
| Nouveau message | Incrémenter `unreadMessages`, notifier selon les préférences |
| Avis reçu ou réponse | Notification `review` ; recalculer `publisher.rating` et `publisher.reviewsCount` |
| Décision KYC | Notification `kyc` avec motif ; mettre à jour `users.kycStatus` et `publisher.verified` ; appeler `invalidateUser(id)` |
| Décision de modération | Notification `listing` avec motif ; audit ; annonce retirée du feed, de la recherche et des fiches si elle n'est plus `active` |
| `suspend_user` | Compte désactivé ; audit ; `invalidateUser(id)` |
| Paramètre modifié | Vider les caches ; effet immédiat sur `/plans`, `/search/options`, `/services/categories`, le prix du contact et le classement |
| Publication | Attribuer le profil propriétaire ou agent ; `pending_kyc` si la certification est requise |
| Consultation, contact, favori | Alimenter `MyItem.stats` (`views`, `contacts`, `favorites`), en limitant les écritures |

Les notifications respectent `NotificationPreferences` : `newMessages`, `searchAlerts`, `reviews`, `payments`, `marketing`, et les canaux `email`, `sms`, `push`. `createNotification` existe déjà. Les liens `href` sont des chemins internes du front.

### Règles serveur que le front ne peut pas garantir

- Masquer téléphones, e-mails et liens dans les messages, les annonces, les profils et les avis. L'alerte du front est une simple aide.
- Revalider toutes les règles de publication (miroir de `src/views/publish/schemas.ts`) et les pièces KYC (`src/lib/kycRequirements.ts`).
- Calculer les permissions côté serveur : le front masque, le serveur refuse.
- Appliquer le classement §11 : plan payant = bonus borné, 60 % minimum de résultats organiques par défaut (`organicQuotaPercent`), bonus de 20 % au plus (`maxPlanBoostPercent`), `sponsored: true` sur toute mise en avant.
- Ne jamais exclure un candidat gratuit, et ignorer tout effet des plans avec `sort=pertinence_pure`.
- Refuser `POST /conversations/open` vers un candidat sans droit `contact` (`403 PLAN_REQUIRED`), sauf si le candidat a engagé l'échange.
- Limiter le débit de l'envoi de messages (`429`).

## 7. À corriger dans le backend existant

| Priorité | Sujet | Constat | Action |
|----------|-------|---------|--------|
| **Haute** | Adresse IP derrière Render | `trust proxy` n'est pas configuré dans `src/app.js`. Les limites de débit risquent de compter tous les visiteurs ensemble. Non vérifié en production. | Ajouter `app.set('trust proxy', 1)` après vérification, puis tester. |
| **Haute** | Limite globale | 200 requêtes par 15 min. Une conversation ouverte génère environ 30 appels par minute : **la limite est atteinte en 7 minutes environ, pour un seul utilisateur**. | Augmenter la limite pour un utilisateur connecté, ou exclure les routes de polling. |
| **Haute** | Limite de connexion | 20 tentatives par 15 min. Toutes les connexions passent par Vercel, donc la même IP peut servir pour tous les utilisateurs. | Compter par compte (email ou téléphone) plutôt que par IP. |
| **Haute** | Fichiers envoyés | `middleware/upload.js` accepte images uniquement, 5 Mo maximum. Le contrat demande 10 Mo pour `/uploads` et 10 Mo avec PDF pour le KYC. | Créer des règles par usage. |
| **Haute** | Documents KYC | Ils ne doivent jamais être publics. L'envoi actuel vers Cloudinary est prévu pour des images publiques. | Choisir un stockage privé avec URL signée. |
| Moyenne | Statistiques admin | `GET /admin/stats` renvoie 0 pour `pendingKyc`, `pendingListings`, `openReports`, `pendingProofs`, `paymentsToday`, `paymentsTodayCount`, `failedPayments24h`. | Brancher avec `count()` quand les collections existent. |
| Moyenne | Statut KYC | `GET /admin/users` lit `users.kycStatus`, que rien ne met à jour. | Le mettre à jour à chaque décision KYC. |
| Moyenne | Index Firestore | `firestore.indexes.json` doit être déployé. Sinon `GET /notifications` lit tout (avertissement dans les logs). | `firebase deploy --only firestore:indexes` et vérifier les logs. |
| Moyenne | Emails | Inscription et mot de passe oublié dépendent d'une clé Brevo active, d'un expéditeur validé et, si le blocage d'IP est activé, d'une IP autorisée. | Vérifier en production. |

## 8. Décisions à prendre avant de coder

À trancher avec le responsable du front ou le métier.

**Données affichées mais qu'aucun écran ne permet de saisir :**

| Sujet | Problème | Question |
|-------|----------|----------|
| Preuves « Formé » et habilitations | Le back-office valide des preuves (`/admin/proofs`), mais **aucun écran ni endpoint ne permet à un utilisateur d'en envoyer**. | Quel parcours d'envoi créer ? Il faudra un écran et un endpoint. |
| Permis et références du candidat | `license` et `references` sont affichés sur le profil, mais absents du formulaire de publication. | Les ajouter au formulaire ou les retirer ? |
| Zones et profession réglementée | `zones` et `regulatedProfession` sont affichés sur la fiche prestataire, mais absents du formulaire. | Les ajouter au formulaire ou les renseigner à la validation admin ? |
| Visites | Un avis peut venir d'une interaction `visit`, mais **aucun écran ne crée de visite** (les routes V1 ont été supprimées). | Retirer ce type ou recréer la fonctionnalité ? |
| `newResults` | Le badge « +N » dépend de la dernière consultation, mais aucun appel ne signale cette consultation. | Faut-il une route dédiée ? |

**Choix métier et techniques :**

- Quel opérateur ou agrégateur Mobile Money utiliser (MTN MoMo, Orange Money) ?
- Quelle durée pour les plans candidats et recruteurs ? 30 jours par défaut, à confirmer.
- Quel prorata si un abonné change de plan ?
- Quelle règle exacte pour `badgeActive` ? Exemple du contrat : `verifie` + abonnement actif.
- Quelle politique de rétention des conversations ?
- Quels canaux réels ? Seul l'email existe aujourd'hui (Brevo) ; SMS et push n'ont pas de fournisseur.
- Comment calculer `participantOnline` sans écrire dans Firestore à chaque requête ?
- Comment acheter une mise en avant ? Le contrat prévoit `sponsor` et `unsponsor` côté admin, sans parcours d'achat.
- Comment représenter propriétaire et agent ? `users.role` vaut toujours `user | landlord | admin | proprietaire`, alors que `publisher.kind` vaut `owner | agent | candidate | recruiter | provider | user`. Un champ séparé est à prévoir.

## 9. Données V1 à reprendre

**Ne supprimez aucune collection V1 avant une migration vérifiée.** Faites un export Firestore avant toute migration. Comptages du 15 octobre 2026 : 61 `properties`, 12 `contacts`, 1 `visits`.

| Collection | Décision |
|------------|----------|
| `users` | Conserver. Compléter les nouveaux champs. Rien ne recrée automatiquement le compte `proprietaire`. |
| `notifications` | Conserver. Les anciens documents sont déjà convertis à la lecture. |
| `auditLog` | Conserver. Les 22 entrées de `adminLogs` y sont déjà migrées. `adminLogs` pourra être supprimée après vérification. |
| `properties` | **À migrer** vers la future collection d'annonces. |
| `contacts`, `visits` | À migrer ou archiver selon les décisions de la section 8. |
| `codes_verification`, `general_contacts` | Conserver. |

Correspondance proposée pour `properties`, à valider :

| V1 | V2.1 | Remarque |
|----|------|----------|
| `title`, `description`, `price`, `amenities` | Mêmes noms | `amenities` doit passer en codes de `/search/options` |
| `type` | `propertyKind` | Convertir vers les codes V2.1 |
| `location` | `city`, `district` | Texte libre à découper |
| `beds`, `baths`, `area` | `bedrooms`, `bathrooms`, `surface` | |
| `images`, `imagePublicIds` | `media[]` | |
| `landlordId` | Publieur | |
| `status: available` + `isActive: true` | `active` | Seules les publications `active` sont visibles |
| `address`, `latitude`, `longitude` | Non publics | Ne pas les exposer sans décision |
| `featured` | Aucun équivalent automatique | Ne pas convertir en `sponsored` |
| Absent | `transaction`, `priceUnit`, `availableNow` | Valeurs à décider (probablement `location` et `mois`) |

## 10. Règles à respecter partout

**Sécurité et confidentialité**

- Aucun téléphone ni WhatsApp avant un `unlock_contact` confirmé par webhook.
- Aucun document KYC dans une réponse publique : uniquement des statuts.
- Sur un candidat : jamais de téléphone, e-mail, adresse, âge, situation familiale, religion, ethnie ou santé.
- Une route `/admin/*` exige un rôle admin **et** la bonne permission : les 11 permissions sont listées dans `src/lib/adminPermissions.ts`.
- Aucune donnée d'un utilisateur ne doit apparaître pour un autre.

**Quota Firestore.** Le forfait Spark autorise 50 000 lectures et 20 000 écritures par jour. Un dépassement bloque l'application jusqu'à minuit, heure du Pacifique.

- Filtrer avec `where`, paginer avec `limit` et `startAfter`. Ne jamais lire une collection entière pour la filtrer en JavaScript, et ne pas utiliser `offset()`.
- Compter avec `count()`.
- Éviter les requêtes en boucle : utiliser `db.getAll()` ou recopier les champs affichés.
- Mettre en cache ce qui change rarement, et vider le cache dans chaque route d'écriture.
- Écrire au plus une vue par visiteur, par objet et par jour.
- Ne pas relire `users/{id}` : `req.user` est déjà chargé.
- Après toute écriture sur `users/{id}` : **appeler `invalidateUser(id)`**, sinon une suspension ou un changement de rôle mettra jusqu'à 60 s à s'appliquer.

**Fonctions déjà disponibles**

| Fichier | Usage |
|---------|-------|
| `src/utils/pagination.js` | `cursorPage(liste, cursor, limit)` pour une liste déjà en mémoire |
| `src/utils/audit.js` | `createAuditEntry(req.user, { action, targetType, targetId, targetLabel, reason, changes })` |
| `src/utils/notifications.js` | `createNotification`, `notifierTousLesAdmins` |
| `src/utils/userCache.js` | `getUser`, `getAllUsers`, `invalidateUser` |
| `src/middleware/role.js` | `requireRole`, `requirePermission` |
| `src/middleware/auth.js` | `authenticate`, `optionalAuth` |

## 11. Un endpoint est terminé quand

- [ ] La réponse correspond au contrat et au type TypeScript.
- [ ] Les statuts et les codes d'erreur du contrat sont respectés, avec un `message` en français.
- [ ] Les permissions sont vérifiées côté serveur et l'accès aux données d'autrui est refusé.
- [ ] Aucune donnée privée n'est renvoyée.
- [ ] La lecture est paginée, sans collection lue en entier, et les index nécessaires sont déclarés dans `firestore.indexes.json`.
- [ ] Les notifications, l'audit et l'invalidation des caches sont en place.
- [ ] L'écran correspondant fonctionne avec le front, sans le mock.
- [ ] La case est cochée dans ce guide.

Quand les 91 endpoints et la section 6 sont faits, on passe `NEXT_PUBLIC_USE_MOCKS=false` en production et on vérifie chaque page de la section 4.
