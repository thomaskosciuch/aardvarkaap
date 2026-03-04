import { Router } from 'express';
import express from 'express';
import * as cronRuns from '../db/cron-runs';
import * as jobs from '../db/jobs';
import * as activityLog from '../db/activity-log';

const router = Router();

// The collector endpoints need JSON body parsing
router.use('/collector', express.json());

/**
 * POST /collector/register
 *
 * Register (or update) a job from an external app.
 * This lets services self-register without going through the Slack UI.
 *
 * Body:
 *   job_name        (string, required)
 *   schedule        (string, optional) — cron expression, e.g. "0 8 * * 1-5"
 *   expected_every_s (number, optional) — max seconds between runs (default: 86400)
 *   description     (string, optional)
 *   severity        (string, optional) — "low" | "medium" | "high" (default: "medium")
 */
router.post('/collector/register', async (req, res) => {
  try {
    const { job_name, schedule, expected_every_s, description, severity } = req.body;

    if (!job_name) {
      res.status(400).json({ error: 'job_name is required' });
      return;
    }

    const existing = await jobs.getJob(job_name);
    if (existing) {
      // Update if already registered
      await jobs.updateJob(job_name, {
        ...(schedule !== undefined && { schedule }),
        ...(expected_every_s !== undefined && { expectedEveryS: expected_every_s }),
        ...(description !== undefined && { description }),
        ...(severity !== undefined && { severity }),
      });
      res.json({ ok: true, action: 'updated' });
      return;
    }

    await jobs.registerJob({
      jobName: job_name,
      schedule: schedule ?? null,
      expectedEveryS: expected_every_s ?? 86400,
      description: description ?? null,
      severity: severity ?? 'medium',
    });
    res.json({ ok: true, action: 'created' });
  } catch (err) {
    console.error('Collector register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /collector/run
 *
 * Log a cron execution. External scripts call this at the start and end of each run.
 * Auto-registers unknown jobs with sensible defaults (daily, medium severity).
 *
 * Body:
 *   job_name    (string, required) — process name (auto-registered if new)
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

    // Auto-register unknown jobs with sensible defaults
    const existing = await jobs.getJob(job_name);
    if (!existing) {
      await jobs.registerJob({
        jobName: job_name,
        expectedEveryS: 86400,   // default: expect at least once a day
        severity: 'medium',
      });
      console.log(`Auto-registered new job: ${job_name}`);
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
