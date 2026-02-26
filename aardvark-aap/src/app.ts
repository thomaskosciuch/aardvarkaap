import express from 'express';
import { receiver } from './slack';
import healthRouter from './routes/health';
import webhookRouter from './routes/webhook';
import './slack/events';
import './slack/commands';

const port = Number(process.env.PORT) || 80;

// Prevent Bolt auth errors from crashing the process
process.on('unhandledRejection', (err: unknown) => {
  console.error('Unhandled rejection (non-fatal):', err instanceof Error ? err.message : err);
});

// Create Express app — our routes run BEFORE Bolt's middleware
// NOTE: No global express.json() — Bolt needs the raw body for signature verification
const app = express();

// Mount routes
app.use(healthRouter);
app.use(webhookRouter);

// Mount Bolt's Express app AFTER our routes
app.use(receiver.app);

// Start
app.listen(port, '0.0.0.0', () => {
  console.log(`Aardvark Slack App listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
