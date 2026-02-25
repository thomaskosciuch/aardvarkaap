const express = require('express');
const { receiver } = require('./slack');

const port = process.env.PORT || 80;

// Prevent Bolt auth errors from crashing the process
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (non-fatal):', err.message || err);
});

// Create Express app — our routes run BEFORE Bolt's middleware
// NOTE: No global express.json() — Bolt needs the raw body for signature verification
const app = express();

// Mount routes
app.use(require('./routes/health'));
app.use(require('./routes/webhook'));

// Register Slack event handlers (side-effect import)
require('./slack/events');

// Mount Bolt's Express app AFTER our routes
app.use(receiver.app);

// Start
app.listen(port, '0.0.0.0', () => {
  console.log(`Aardvark Slack App listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
