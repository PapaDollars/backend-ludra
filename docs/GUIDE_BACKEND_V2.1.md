# LUDRA HOME V2.1 — Guide 

Mis à jour le 1er novembre 2026, d'après la branche `lewis` (commit `6291356`).

Ce guide explique comment fonctionne le front V2.1, ce qui est fait, ce qui reste à construire et ce qu'il ne faut pas oublier. Le détail des champs et des réponses est dans le contrat API.

| Document | Rôle | Emplacement |
|----------|------|-------------|
| **Ce guide** | Vue d'ensemble, ordre de travail, liste à cocher, pièges | `backend-ludra/docs/` |
| **Contrat API** | Forme exacte de chaque requête et réponse | [`docs/API_CONTRACT_V2.1.md`](https://github.com/PapaDollars/frontend-ludra/blob/main/docs/API_CONTRACT_V2.1.md) (dépôt front) |
| **Types TypeScript** | Référence en cas de doute | `src/types/` (dépôt front) |
| **Mocks** | Exemples réalistes et règles métier simulées | `src/mocks/` (dépôt front) |

En cas de contradiction : les types priment sur le contrat, et le contrat prime sur ce guide.

## 1. La situation en bref

LUDRA est maintenant un feed avec **trois univers** : immobilier, personnel (candidats et recruteurs) et services. Le site comprend aussi une messagerie, le déblocage payant du contact, la certification KYC, des abonnements, des avis et un back-office complet.

| État | Endpoints | Détail |
|------|-----------|--------|
| ✅ Terminés | **49** | Auth, compte de base, personnel, messagerie, brouillons, abonnements, reçus, preuves, paiements admin |
| 🟡 Partiels | **7** | La route existe, mais une partie du contrat manque |
| ⬜ Absents | **54** | Dont tout le cœur immobilier et services |
| **Total** | **110** | Plus le webhook opérateur, hors décompte |

**Le blocage principal : il n'existe pas encore de collection d'annonces.** Sans elle, on ne peut ni publier un bien, ni afficher le feed, ni ouvrir une fiche, ni débloquer un contact. L'accueil du site dépend de `GET /feed`, qui n'existe pas. Les 61 annonces V1 sont toujours dans `properties`, mais aucune route ne les sert.

Le front tourne encore sur ses données de démo, sauf pour l'authentification. Tant que les endpoints absents ne sont pas faits, **ne pas passer `NEXT_PUBLIC_USE_MOCKS=false` en production**.

**Pile backend :** Express + Firestore (forfait gratuit Spark) + Cloudinary + Brevo, hébergé sur Render. Le front n'a pas de SDK Firebase : **tout passe par cette API**.

### État des branches

| Branche | Contenu |
|---------|---------|
| `lewis` | Tout le travail décrit ici. **Non fusionnée.** |
| `main` | Contient seulement une partie du personnel. **Render déploie cette branche : la messagerie, les brouillons et les paiements ne sont pas en production.** |
| `dev` | Contient une version plus ancienne de ce guide. |

À la fusion, garder **cette version** du guide et du README.

## 2. Comment le front parle à l'API

**Base.** `NEXT_PUBLIC_API_URL` doit inclure `/api`, par exemple `https://backend-ludra.onrender.com/api`. Aucun préfixe de version.

**Enveloppe de réponse.**

```json
{ "success": true, "data": {}, "message": "optionnel" }
{ "success": false, "message": "Texte affiché à l'utilisateur", "code": "OPTIONNEL", "errors": [{ "field": "price", "message": "Indiquez le prix." }] }
```

**Le `message` d'erreur est affiché tel quel** : écrivez-le en français, pour l'utilisateur. Quand `errors` est présent, ses messages remplacent `message`. Utilisez `AppError`, `notFound` et `validationError` (`src/utils/AppError.js`).

**Listes.** Le format est `{ items, nextCursor, total? }`. `nextCursor: null` signifie fin de liste. Le curseur est opaque pour le front.

**Authentification.**

1. La connexion passe par NextAuth, **côté serveur Vercel**, qui appelle `POST /auth/login`. L'adresse IP vue par le backend est donc celle de Vercel, pas celle du visiteur.
2. Le front envoie ensuite `Authorization: Bearer <accessToken>`.
3. Sur une réponse `401`, il appelle `POST /auth/refresh-token` avec `{ refreshToken }`, rejoue la requête une fois, puis déconnecte l'utilisateur.
4. Une réponse `403` avec `code: "ACCOUNT_DISABLED"` déconnecte l'utilisateur.
5. `GET /auth/me` doit renvoyer au minimum : `id, name, email, phone, whatsapp, city, avatar, role, adminPermissions, emailVerified, phoneVerified, deletionRequestedAt`.

Routes « publiques » : le token est facultatif, mais s'il est présent la réponse est personnalisée (`isFavorite`, `viewerIsOwner`, `viewerAccess`…).

**Appels répétés.** Ils déterminent la charge réelle. Ils s'arrêtent quand l'onglet est masqué, sauf le suivi d'un paiement.

| Quoi | Fréquence | Appels |
|------|-----------|--------|
| Conversation ouverte | Toutes les 4 s | `GET /conversations/:id/messages?after=` + `GET /conversations/:id` |
| Liste des conversations | Toutes les 15 s, y compris quand une conversation est ouverte | `GET /conversations` |
| Badges du header | Toutes les 30 s et à chaque changement de page | `GET /me/counters` |
| Dossier KYC en revue | Toutes les 5 s | `GET /kyc` |
| Paiement en attente | Toutes les 3 s, 2 min maximum | `GET /payments/:id` |
| Sauvegarde d'un brouillon | ~1,2 s après une modification | `PATCH /drafts/:id` |
| Compteur de la recherche | 300 ms après un changement de filtre | `GET /search/count` |

## 3. Tester

**Tests backend :** `npm test` (75 tests, tous au vert au 1er novembre 2026). `tests/helpers/fakeFirestore.js` remplace Firestore en mémoire.

**Avec le front :**

```bash
# Dans frontend-ludra/.env.local, puis redémarrer le front
NEXT_PUBLIC_API_URL=http://localhost:5000/api
NEXT_PUBLIC_USE_MOCKS=false
```

```bash
# Dans backend-ludra/.env
PAYMENT_PROVIDER=simulation   # paid après ~6 s ; un numéro finissant par 0000 échoue
```

- **La bascule du front est globale.** À `false`, tous les écrans appellent la vraie API. L'accueil échouera donc tant que `/feed` n'existe pas. Testez directement `/personnel`, `/messages` ou `/publier`.
- Pour brancher un seul service, remplacez `withMock(mock, réel)` par l'appel réel dans `src/services/<module>.service.ts`, sur une branche de test.
- `scripts/seed-demo-candidates.js` crée 5 profils de démo. **Ne pas le lancer sur la base de production** : ces profils apparaîtraient dans la recherche.

Les fichiers de `src/mocks/` montrent la réponse attendue et les règles simulées.

## 4. Pages du front et lots de travail

| Pages du front | État | Lots |
|----------------|------|------|
| `/`, `/immobilier` | ⬜ | A |
| `/recherche` | 🟡 Personnel seulement | A, F |
| `/annonces/:id` | ⬜ | A, B, G |
| `/messages`, `/messages/:id` | 🟡 Sans images ni badge non lu | A, C |
| `/publier` | 🟡 Personnel seulement | A |
| `/personnel`, `/personnel/candidats/:id`, `/personnel/abonnements`, `/personnel/forfaits`, `/personnel/shortlist` | ✅ Favoris exceptés | F |
| `/services`, `/services/:categorie`, `/services/prestataires/:id` | ⬜ | A |
| `/avis/:userId`, `/compte/avis` | ⬜ | G |
| `/notifications` | ✅ | — |
| `/compte`, `/compte/parametres` | 🟡 Profil seulement | H |
| `/compte/annonces` | ⬜ | A |
| `/compte/favoris` | ⬜ | F |
| `/compte/paiements`, `/compte/paiements/recu/:id`, `/compte/abonnements` | ✅ Hors déblocages | B |
| `/compte/certification` | ⬜ | E |
| `/admin/dashboard`, `/admin/utilisateurs`, `/admin/paiements`, `/admin/personnel` | 🟡 Compteurs et file incomplets | I |
| `/admin/annonces`, `/admin/verifications`, `/admin/signalements`, `/admin/parametres`, `/admin/journal` | ⬜ | I |
| `/auth/*`, `/aide`, `/a-propos` | ✅ | — |

## 5. Liste à cocher

L'ordre suit les dépendances : d'abord les annonces, dont presque tout dépend. « Étape N » renvoie à la section du contrat API.

### Priorité 0 — Avant toute mise en production

Voir la [section 7](#7-à-corriger-dans-le-code-existant). Fusionner `lewis`, corriger les limites de requêtes et réduire le coût de la messagerie.

### Lot A — Annonces, prestataires et feed (12 + 4 partiels) · étapes 1, 2, 3, 5, 9, 10

Définir d'abord les collections d'annonces et de prestataires, puis migrer les 61 `properties` ([section 9](#9-données-v1-à-reprendre)).

- [ ] `POST /drafts/:id/publish` — **Partiel :** `personnel` seulement ; `immobilier` et `services` répondent `501`. Manquent aussi `pending_kyc`, `pending_review` et `sourceItemId`.
- [ ] `GET /search` — **Partiel :** `personnel` seulement ; `immobilier` et `services` répondent `501`.
- [ ] `GET /search/count` — **Partiel :** mêmes limites.
- [ ] `POST /conversations/open` — **Partiel :** `itemId` n'accepte qu'un profil candidat. Une annonce ou un prestataire répond `404`.
- [ ] `GET /listings/:id` (jamais de téléphone avant paiement)
- [ ] `GET /services/providers/:id`
- [ ] `GET /services/categories`
- [ ] `GET /feed`
- [ ] `GET /feed/suggested-accounts`
- [ ] `GET /me/items`
- [ ] `PATCH /me/items/:id/status`
- [ ] `POST /me/items/:id/edit`
- [ ] `POST /saved/toggle`
- [ ] `GET /admin/settings`
- [ ] `PUT /admin/settings` (journalisé ; appeler `invalidateSettings()`)
- [ ] `GET /me/counters` (appelé par le header ; `unreadMessages` et `unreadNotifications`)

### Lot B — Déblocage du contact (2 + 1 partiel) · étapes 3, 10

Le mécanisme de paiement existe déjà. Il reste à y ajouter l'objet `unlock_contact`.

- [ ] `POST /payments/unlock-contact` (header `Idempotency-Key`, pas de double débit)
- [ ] `GET /listings/:id/contact` (`402` si non payé)
- [ ] `GET /me/unlocks` — **Partiel :** répond toujours `[]`.

### Lot C — Messagerie (1 partiel) · étape 4

- [ ] `POST /conversations/:id/messages` — **Partiel :** texte uniquement ; une image répond `501`, alors que l'écran permet d'en joindre.
- [x] `GET /conversations`
- [x] `GET /conversations/:id`
- [x] `GET /conversations/:id/messages`
- [x] `POST /conversations/:id/read`
- [x] `POST /conversations/:id/block`
- [x] `DELETE /conversations/:id/block`

### Lot D — Publication et brouillons · étape 5

- [x] `GET /drafts`
- [x] `POST /drafts`
- [x] `GET /drafts/:id`
- [x] `PATCH /drafts/:id`
- [x] `DELETE /drafts/:id`
- [x] `POST /uploads`

### Lot E — Certification KYC (6) · étape 6

- [ ] `GET /kyc`
- [ ] `PUT /kyc/profile`
- [ ] `POST /kyc/documents` (stockage privé, PDF accepté, jamais d'URL renvoyée)
- [ ] `DELETE /kyc/documents/:id`
- [ ] `PUT /kyc/locations`
- [ ] `POST /kyc/submit`

### Lot F — Favoris et recherches sauvegardées (10) · étapes 2, 10

`isFavorite` est toujours `false` tant que ce lot n'est pas fait. Il doit devenir exact partout : feed, recherche, fiches.

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

### Lot G — Avis et signalements (7) · étapes 3, 7

- [ ] `GET /users/:userId/reviews`
- [ ] `GET /me/reviews/received`
- [ ] `GET /reviews/eligibility`
- [ ] `POST /reviews`
- [ ] `PATCH /reviews/:id`
- [ ] `POST /reviews/:id/reply`
- [ ] `POST /reports`

### Lot H — Mon compte (5) · étape 10

- [ ] `GET /me/overview`
- [ ] `GET /me/preferences`
- [ ] `PUT /me/preferences`
- [ ] `POST /me/password`
- [ ] `POST /me/logout-all`

### Lot I — Back-office (12 + 1 partiel) · étape 11

Chaque décision écrit une entrée d'audit avec `createAuditEntry`. Un motif d'au moins 5 caractères est obligatoire pour toute décision négative (sinon `422`).

- [ ] `GET /admin/stats` — **Partiel :** `pendingKyc`, `pendingListings` et `openReports` valent toujours 0.
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
- [ ] `GET /admin/audit`
- [x] `GET /admin/users`
- [x] `PATCH /admin/users/:id`
- [x] `GET /admin/proofs`
- [x] `POST /admin/proofs/:id/decision`
- [x] `GET /admin/payments`
- [x] `POST /admin/payments/:id/reconcile`

### Terminé (reste du périmètre)

**Auth et compte de base**

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

**Référentiels**

- [x] `GET /search/options` (liste fixe dans `config/referentials.js`, à rendre administrable)
- [x] `GET /search/suggestions`
- [x] `GET /plans`

**Personnel**

- [x] `GET /candidates/:id`
- [x] `GET /me/candidate-profile`
- [x] `GET /recruiter/access`
- [x] `GET /recruiter/shortlist`
- [x] `POST /recruiter/shortlist`
- [x] `DELETE /recruiter/shortlist/:candidateId`
- [x] `GET /recruiter/shortlist/export`

**Paiements et abonnements**

- [x] `POST /payments/subscription`
- [x] `GET /payments/:id`
- [x] `GET /subscriptions/me`
- [x] `GET /me/payments`
- [x] `GET /me/payments/:id`

## 6. Ce que le front ne révèle pas

Ces traitements n'apparaissent dans aucun appel du front. Le site peut sembler complet alors qu'ils manquent.

### Paiements réels

| Sujet | État |
|-------|------|
| Simulation | Fonctionne hors production. Refusée en production. |
| Production | Sans `PAYMENT_PROVIDER` valide, tout paiement répond `503 PAYMENT_UNAVAILABLE`. |
| Orange Money | Écrit dans `services/providers/orangeCM.js` **à partir de clients communautaires, pas de la documentation d'Orange**. Chemins, statuts, format des numéros et callback sont à valider. **Ne pas activer avec de vrais débits avant cette validation.** |
| MTN MoMo | **Aucun fournisseur branché** : `mtn_momo` répond `503`, alors que le front propose cet opérateur. |
| Webhook | `POST /payments/webhooks/orange/:secret`. Le callback sert seulement de déclencheur : le résultat vient toujours d'une vérification auprès d'Orange. Une seule règle à garder : `paid` ne vient jamais du contenu d'un callback non vérifié. |

### Tâches planifiées

| Tâche | État | À faire |
|-------|------|---------|
| Suppression de compte | ⬜ | **Le site promet 72 h, et aucun code ne le fait.** Supprimer les comptes dont `deletionScheduledAt` est dépassé, en conservant les reçus (obligation légale). |
| Expiration des abonnements | ✅ | Calculée à la lecture : droits recruteur et plan candidat redeviennent inactifs sans tâche planifiée. |
| Rappel d'expiration | ⬜ | Notification `subscription` avant l'échéance. |
| Paiements sans réponse | 🟡 | Expirés à la lecture après 15 min. Le réconciliateur tourne seulement avec un fournisseur réel et s'arrête si l'instance dort. |
| Expiration KYC | ⬜ | Passer à `expire`, retirer le badge, mettre à jour `kycStatus`. |
| Alertes de recherche | ⬜ | Calculer `newResults`, notifier si `alertEnabled`. |
| Rétention des conversations | ⬜ | Politique à définir. |

Un `setInterval` dans le serveur n'est pas fiable si Render met l'instance en veille (offre gratuite). Prévoyez un déclencheur externe qui appelle une route protégée par un secret, ou une instance toujours active.

### Effets de bord par événement

| Événement | État | À faire côté serveur |
|-----------|------|----------------------|
| Nouveau message | 🟡 | Notification créée. Reste : `unreadMessages` dans `/me/counters` et les préférences. |
| Paiement confirmé ou échoué | ✅ | Reçu séquentiel et notification. Adapter le titre pour `unlock_contact` (« activé » concerne les abonnements). |
| Abonnement activé | ✅ | Même transaction que le paiement ; plan candidat mis à jour. |
| Décision sur preuve | ✅ | Badge, audit, notification. |
| Décision KYC | ⬜ | Notification avec motif ; `users.kycStatus` ; `invalidateUser(id)` ; **recopier le badge dans `candidates.publisher.verified` et `conversations.people`**, qui sont aujourd'hui figés. |
| Changement de nom ou d'avatar | ⬜ | Même problème : ces champs recopiés ne sont jamais mis à jour. |
| Avis reçu ou réponse | ⬜ | Notification `review` ; recalculer `publisher.rating` et `publisher.reviewsCount`. |
| Décision de modération | ⬜ | Notification avec motif ; audit ; retirer du feed, de la recherche et des fiches ce qui n'est plus `active`. |
| `suspend_user` | ⬜ | Compte désactivé ; audit ; `invalidateUser(id)` ; masquer ses publications. |
| Paramètre modifié | ⬜ | Vider les caches ; effet immédiat sur les prix, les catégories et le classement. |
| Publication immobilière | ⬜ | Attribuer le profil propriétaire ou agent ; `pending_kyc` si la certification est requise. |
| Consultation, contact, favori | ⬜ | Alimenter `MyItem.stats`, en limitant les écritures. |

**Préférences de notification :** `createNotification` ne les consulte pas encore. Il faudra respecter `newMessages`, `searchAlerts`, `reviews`, `payments`, `marketing` et les canaux `email`, `sms`, `push`.

### Règles serveur à conserver

Déjà appliquées pour le personnel et la messagerie, à reproduire pour les annonces, les services et les avis :

- Masquer téléphones, e-mails et liens (`maskContacts`, `moderateMessage` dans `utils/text.js`).
- Revalider toutes les règles de publication (miroir de `src/views/publish/schemas.ts`) et les pièces KYC (`src/lib/kycRequirements.ts`).
- Calculer les permissions côté serveur : le front masque, le serveur refuse.
- Appliquer le classement §11 : plan payant = bonus borné, 60 % minimum de résultats organiques par défaut, bonus de 20 % au plus, `sponsored: true` sur toute mise en avant.

## 7. À corriger dans le code existant

| Priorité | Sujet | Constat | Action |
|----------|-------|---------|--------|
| **Bloquant** | Déploiement | `lewis` n'est pas fusionnée. | Fusionner vers `main`, déployer `firestore.indexes.json` (**10 index**), configurer les nouvelles variables de `.env.example`. |
| **Haute** | Adresse IP derrière Render | `trust proxy` est toujours absent de `src/app.js`. Les limites de débit par IP, y compris les nouvelles, risquent de compter tous les visiteurs ensemble. Non vérifié en production. | Ajouter `app.set('trust proxy', 1)` après vérification, puis tester. |
| **Haute** | Limite globale | 200 requêtes par 15 min. Une conversation ouverte génère environ 30 appels par minute, plus la liste : **la limite est atteinte en moins de 7 minutes, pour un seul utilisateur**. | Augmenter la limite pour un utilisateur connecté, ou exclure les routes de polling. |
| **Haute** | Limite de connexion | 20 tentatives par 15 min. Toutes les connexions passent par Vercel, donc la même IP peut servir pour tous. | Compter par compte plutôt que par IP. |
| **Haute** | Coût de la messagerie | Calcul d'après le code : 3 lectures toutes les 4 s pour une conversation, jusqu'à 21 toutes les 15 s pour la liste. **Soit jusqu'à 7 700 lectures par heure pour un seul utilisateur**, sur un quota de 50 000 par jour. | Cache court sur les conversations, liste moins fréquente ou réponse « rien de nouveau ». |
| **Haute** | Accès à un candidat | `POST /conversations/open` applique `PLAN_REQUIRED` selon le **destinataire**, pas l'objet. Testé : un utilisateur sans forfait est refusé s'il écrit à une personne qui a un profil candidat, même sans objet. Une personne avec un profil candidat **et** une annonce ne serait donc plus contactable. | Baser la règle sur l'objet de la conversation. |
| Moyenne | Coût de la recherche | `findActiveCandidates` lit tous les profils correspondants, puis trie en mémoire (cache 60 s). Correct pour quelques centaines de profils. | Prévoir une pagination réelle avant que le volume monte ; ne pas recopier ce modèle pour les annonces. |
| Moyenne | Documents KYC | L'envoi actuel vers Cloudinary est prévu pour des images publiques, sans PDF. | Choisir un stockage privé avec URL signée. |
| Moyenne | Statut KYC | `users.kycStatus` est lu partout, mais rien ne l'écrit. | Le mettre à jour à chaque décision KYC. |
| Moyenne | Emails | Inscription et mot de passe oublié dépendent d'une clé Brevo active, d'un expéditeur validé et, si le blocage d'IP est activé, d'une IP autorisée. | Vérifier en production. |
| Basse | Images orphelines | Un upload non publié reste dans `uploads` et sur Cloudinary. | Nettoyage périodique. |

## 8. Décisions à prendre

À trancher avec le responsable du front ou le métier.

**Données affichées mais qu'aucun écran ne permet de saisir :**

| Sujet | État | Question |
|-------|------|----------|
| Preuves « Formé » | Une preuve est créée depuis le texte `training`, **sans pièce jointe**. L'admin valide donc sur simple déclaration. | Faut-il un envoi de justificatif ? Il faudra un écran et un endpoint. |
| Habilitations | **Rien ne crée de preuve `habilitation`**, et le badge `regulatedVerified` ne peut pas s'activer. | Quel parcours d'envoi ? À traiter avec les prestataires. |
| Permis et références du candidat | `license` et `references` sont stockés et affichés, mais absents du formulaire. Seul le script de démo les remplit. | Les ajouter au formulaire ou les retirer ? |
| Zones et profession réglementée | `zones` et `regulatedProfession` sont affichés sur la fiche prestataire, mais absents du formulaire. | Les ajouter ou les renseigner à la validation admin ? |
| Visites | Un avis peut venir d'une interaction `visit`, mais **aucun écran ne crée de visite**. | Retirer ce type ou recréer la fonctionnalité ? |
| `newResults` | Le badge « +N » dépend de la dernière consultation, mais aucun appel ne la signale. | Faut-il une route dédiée ? |

**Choix métier et techniques :**

- Quel fournisseur pour MTN MoMo ? Et Orange : API directe validée, ou agrégateur couvrant les deux opérateurs ?
- Durée des plans candidats et recruteurs : 30 jours codés par défaut, à confirmer.
- Changement de plan : le code prolonge si le plan est identique, et **remplace immédiatement sans prorata** sinon. Le temps restant est perdu. À confirmer.
- Badge public : le contrat donne en exemple `verifie` + abonnement actif, le code des candidats utilise seulement `kycStatus === 'verifie'`. Quelle règle exacte ?
- Politique de rétention des conversations ?
- Canaux réels : seul l'email existe (Brevo). SMS et push n'ont pas de fournisseur.
- Présence en ligne : `participantOnline` vaut toujours `false`. Comment la calculer sans écrire dans Firestore à chaque requête ?
- Mise en avant : le contrat prévoit `sponsor` et `unsponsor` côté admin, sans parcours d'achat.
- Propriétaire et agent : `users.role` vaut `user | landlord | admin | proprietaire`, alors que `publisher.kind` vaut `owner | agent | candidate | recruiter | provider | user`. Un champ séparé est à prévoir.

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

Collections créées par `lewis` : `candidates`, `drafts`, `uploads`, `conversations` (avec `messages`), `shortlists`, `subscriptions`, `payments`, `proofs`, `counters`, `locks`, `settings`.

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

- Aucun téléphone ni WhatsApp avant un `unlock_contact` confirmé.
- Aucun document KYC dans une réponse publique : uniquement des statuts.
- Sur un candidat : jamais de téléphone, e-mail, adresse, âge, situation familiale, religion, ethnie ou santé.
- Une route `/admin/*` exige un rôle admin **et** la bonne permission : les 11 permissions sont listées dans `src/lib/adminPermissions.ts` (dépôt front).
- Aucune donnée d'un utilisateur ne doit apparaître pour un autre.

**Quota Firestore.** Le forfait Spark autorise 50 000 lectures et 20 000 écritures par jour. Un dépassement bloque l'application jusqu'à minuit, heure du Pacifique.

- Filtrer avec `where`, paginer avec `limit` et `startAfter`. Ne pas utiliser `offset()`.
- Compter avec `count()`.
- Éviter les requêtes en boucle : utiliser `db.getAll()` ou recopier les champs affichés, **en prévoyant leur mise à jour**.
- Mettre en cache ce qui change rarement, et vider le cache dans chaque route d'écriture.
- Écrire au plus une vue par visiteur, par objet et par jour.
- Ne pas relire `users/{id}` : `req.user` est déjà chargé.
- Après toute écriture sur `users/{id}` : **appeler `invalidateUser(id)`**, sinon une suspension ou un changement de rôle mettra jusqu'à 60 s à s'appliquer.

**Fonctions déjà disponibles**

| Fichier | Usage |
|---------|-------|
| `src/utils/AppError.js` | `AppError`, `notFound`, `validationError` |
| `src/utils/pagination.js` | `cursorPage`, `encodeCursor`, `decodeCursor` |
| `src/utils/audit.js` | `createAuditEntry(req.user, { action, targetType, targetId, targetLabel, reason, changes })` |
| `src/utils/notifications.js` | `createNotification`, `notifierTousLesAdmins` |
| `src/utils/userCache.js` | `getUser`, `getAllUsers`, `invalidateUser` |
| `src/utils/text.js` | `maskContacts`, `moderateMessage`, `normalize`, `tokenize` |
| `src/utils/ttlCache.js` | Cache mémoire avec durée de vie |
| `src/services/settings.service.js` | `getSettings`, `findPlan`, `invalidateSettings` |
| `src/services/payments.service.js` | Cycle complet des paiements (`settlePayment`, idempotence) |
| `src/middleware/role.js` | `requireRole`, `requirePermission` |
| `src/middleware/auth.js` | `authenticate`, `optionalAuth` |

## 11. Un endpoint est terminé quand

- [ ] La réponse correspond au contrat et au type TypeScript.
- [ ] Les statuts et les codes d'erreur du contrat sont respectés, avec un `message` en français.
- [ ] Les permissions sont vérifiées côté serveur et l'accès aux données d'autrui est refusé.
- [ ] Aucune donnée privée n'est renvoyée.
- [ ] La lecture est paginée, sans collection lue en entier, et les index nécessaires sont déclarés dans `firestore.indexes.json`.
- [ ] Les notifications, l'audit et l'invalidation des caches sont en place.
- [ ] Des tests couvrent les règles métier (`npm test`).
- [ ] L'écran correspondant fonctionne avec le front, sans le mock.
- [ ] La case est cochée dans ce guide.

Quand tous les endpoints et la section 6 sont faits, on passe `NEXT_PUBLIC_USE_MOCKS=false` en production et on vérifie chaque page de la section 4.

## 12. Vérifications faites le 1er novembre 2026

| Vérification | Résultat |
|--------------|----------|
| `npm test` sur `lewis` | 75 tests sur 75 réussis |
| Routes montées, comparées aux 110 appels du front | 56 présentes, 54 absentes, plus le webhook |
| Parcours HTTP sur base simulée : brouillon, upload, publication, recherche, fiche, souscription, shortlist, export, conversation, blocage, preuve, paiements admin | Fonctionnent |
| 28 réponses réelles contrôlées par `tsc` avec les types du front | Conformes |
| Coordonnées dans les réponses publiques et masquage des textes | Aucune fuite constatée |

**Non vérifié :** vraie base Firestore, index déployés, vrais écrans du front branchés sur cette API, API Orange réelle, comportement réel des limites de débit derrière Render.
