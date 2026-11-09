const express = require('express');
const router = express.Router();

// Routes conservées de la V1 (encore utilisées par le front)
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/contacts', require('./contacts.routes'));

// Routes V2.1 (docs/API_CONTRACT_V2.1.md côté frontend)
router.use('/admin', require('./admin.routes'));
router.use('/notifications', require('./notifications.routes'));

// Placement du personnel (modules 10 à 13) + plans / abonnements / paiements
const billing = require('./billing.routes');
router.use('/search', require('./search.routes'));
router.use('/candidates', require('./candidates.routes'));
router.use('/recruiter', require('./recruiter.routes'));
router.use('/me', require('./me.routes'));
router.use('/conversations', require('./conversations.routes'));
router.use('/plans', billing.plans);
router.use('/subscriptions', billing.subscriptions);
router.use('/payments/webhooks', billing.webhooks); // avant /payments (qui exige un JWT)
router.use('/payments', billing.payments);

// Publication « + Publier » (module 06)
const publish = require('./publish.routes');
router.use('/drafts', publish.drafts);
router.use('/uploads', publish.uploads);

module.exports = router;
