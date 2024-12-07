const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController.js');
const coinflipController = require('../controllers/coinflipController.js');
const cors = require('cors'); // Import CORS for selective use

const expressQueue = require('express-queue');
const queueMw = expressQueue({ activeLimit: 1, queuedLimit: -1 });

// Selective CORS: If you want specific routes to have different CORS behavior
router.post('/signup', cors(), accountController.create_account_post);
router.post('/login', cors(), accountController.login_account_post);
router.get('/auto-login', cors(), accountController.authenticateToken, accountController.auto_login);
router.post('/coinflip/create', cors(), queueMw, accountController.authenticateToken, coinflipController.create_coinflip);
router.get('/coinflip/:id', cors(), coinflipController.view_coinflip);
router.post('/join/coinflip', cors(), queueMw, accountController.authenticateToken, coinflipController.join_coinflip);

module.exports = router;
s