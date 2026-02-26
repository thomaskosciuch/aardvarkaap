import { Router } from 'express';
import { messages } from '../store';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    webhookMessages: messages.length,
  });
});

export default router;
