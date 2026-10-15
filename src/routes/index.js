const express = require('express');
const router = express.Router();

// Routes conservées de la V1 (encore utilisées par le front)
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/contacts', require('./contacts.routes'));

// Routes V2.1 (docs/API_CONTRACT_V2.1.md côté frontend)
router.use('/admin', require('./admin.routes'));
router.use('/notifications', require('./notifications.routes'));

module.exports = router;
