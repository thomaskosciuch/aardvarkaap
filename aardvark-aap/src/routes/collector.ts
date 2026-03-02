import { Router } from 'express';
import express from 'express';
import * as cronRuns from '../db/cron-runs';
import * as jobs from '../db/jobs';
import * as activityLog from '../db/activity-log';

const router = Router();

// The collector endpoints need JSON body parsing
router.use('/collector', express.json());

/**
 * POST /collector/run
 *
 * Log a cron execution. External scripts call this at the start and end of each run.
 *
 * Body:
 *   job_name    (string, required) — registered process name
 *   status      (string, required) — "started" | "success" | "failed"
 *   message     (string, optional) — human-readable detail / error output
 *   duration_s  (number, optional) — wall-clock seconds the run took
 *   triggered_by (string, optional) — "schedule" (default), "manual", or a username
 */
router.post('/collector/run', async (req, res) => {
  try {
    const { job_name, status, message, duration_s, triggered_by } = req.body;

    if (!job_name || !status) {
      res.status(400).json({ error: 'job_name and status are required' });
      return;
    }

    const validStatuses = ['started', 'success', 'failed'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    // Verify the job is registered
    const existing = await jobs.getJob(job_name);
    if (!existing) {
      res.status(404).json({
        error: `Job '${job_name}' is not registered. Register it first via the Aardvark Slack app (gear icon → Add Process).`,
      });
      return;
    }

    const id = await cronRuns.logRun({
      jobName: job_name,
      status,
      message: message ?? undefined,
      durationS: duration_s ?? undefined,
      triggeredBy: triggered_by ?? 'schedule',
    });

    // Log failures to the activity log for audit
    if (status === 'failed') {
      await activityLog.logActivity({
        jobName: job_name,
        eventType: 'run_failed',
        actor: triggered_by ?? 'schedule',
        detail: message ?? undefined,
      });
    }

    res.json({ ok: true, id });
  } catch (err) {
    console.error('Collector error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /collector/status/:job_name
 *
 * Quick health check — returns the latest run for a job.
 */
router.get('/collector/status/:job_name', async (req, res) => {
  try {
    const runs = await cronRuns.getRunsForJob(req.params.job_name, 1);
    if (runs.length === 0) {
      res.status(404).json({ error: 'No runs recorded for this job' });
      return;
    }
    res.json({ ok: true, latest: runs[0] });
  } catch (err) {
    console.error('Collector status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
