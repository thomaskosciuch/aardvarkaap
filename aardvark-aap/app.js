const express = require('express');
const { receiver } = require('./slack');
const db = require('./db');

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

require('./slack/events');
require('./slack/commands');

// Register Slack slash commands (side-effect import)
require('./slack/commands');

// Mount Bolt's Express app AFTER our routes
app.use(receiver.app);

// Initialize database schema, then start the server
db.init()
  .then(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Aardvark Slack App listening on port ${port}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err.message);
    // Start the server anyway so health checks pass — DB commands will fail gracefully
    app.listen(port, '0.0.0.0', () => {
      console.log(`Aardvark Slack App listening on port ${port} (database unavailable)`);
    });
  });

module.exports = app;
