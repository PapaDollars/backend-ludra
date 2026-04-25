const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/properties', require('./properties.routes'));
router.use('/favorites', require('./favorites.routes'));
router.use('/contacts', require('./contacts.routes'));
router.use('/visits', require('./visits.routes'));
router.use('/admin', require('./admin.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/landlord', require('./landlord.routes'));

module.exports = router;
