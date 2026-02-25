const { Router } = require('express');
const store = require('../store');

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    webhookMessages: store.messages.length,
  });
});

module.exports = router;
