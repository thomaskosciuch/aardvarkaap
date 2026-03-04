import { getPool } from './connection';
import { CronExpressionParser } from 'cron-parser';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type JobStatus = 'started' | 'success' | 'failed' | 'missed';

export interface CronRun {
  id: number;
  jobName: string;
  status: JobStatus;
  message: string | null;
  durationS: number | null;
  triggeredBy: string;
  createdAt: Date;
}

export interface LogRunInput {
  jobName: string;
  status: JobStatus;
  message?: string;
  durationS?: number;
  triggeredBy?: string;
}

function rowToRun(row: RowDataPacket): CronRun {
  return {
    id: row.id,
    jobName: row.job_name,
    status: row.status,
    message: row.message,
    durationS: row.duration_s,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
  };
}

/** Append a new execution row. Returns the inserted row ID. */
export async function logRun(input: LogRunInput): Promise<number> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO aardvark_cron_runs (job_name, status, message, duration_s, triggered_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.jobName,
        input.status,
        input.message ?? null,
        input.durationS ?? null,
        input.triggeredBy ?? 'schedule',
      ],
    );
    return result.insertId;
  } finally {
    conn.release();
  }
}

/** Get recent runs for a specific job. */
export async function getRunsForJob(jobName: string, limit = 20): Promise<CronRun[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_cron_runs WHERE job_name = ? ORDER BY created_at DESC LIMIT ?',
      [jobName, limit],
    );
    return rows.map(rowToRun);
  } finally {
    conn.release();
  }
}

/** Get recent runs across all jobs. */
export async function getRecentRuns(limit = 50): Promise<CronRun[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_cron_runs ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map(rowToRun);
  } finally {
    conn.release();
  }
}

/** Get the latest run for each active job (for dashboard / digest). */
export async function getLatestRunPerJob(): Promise<CronRun[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT cr.*
      FROM aardvark_cron_runs cr
      INNER JOIN (
        SELECT job_name, MAX(created_at) AS max_created
        FROM aardvark_cron_runs
        GROUP BY job_name
      ) latest ON cr.job_name = latest.job_name AND cr.created_at = latest.max_created
      ORDER BY cr.created_at DESC
    `);
    return rows.map(rowToRun);
  } finally {
    conn.release();
  }
}

/**
 * Find active jobs that haven't reported a 'started' or 'success' row
 * within their expected_every_s window. Schedule-aware: if a job has a cron
 * expression, it checks whether the job was actually expected to run recently
 * (e.g. M-F jobs won't be flagged on weekends).
 */
export async function findMissedJobs(): Promise<string[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // Get all active jobs that have no recent heartbeat
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT jr.job_name, jr.schedule, jr.expected_every_s
      FROM aardvark_job_registry jr
      WHERE jr.active = 1
        AND NOT EXISTS (
          SELECT 1 FROM aardvark_cron_runs cr
          WHERE cr.job_name = jr.job_name
            AND cr.status IN ('started', 'success')
            AND cr.created_at >= DATE_SUB(NOW(), INTERVAL jr.expected_every_s SECOND)
        )
    `);

    // Filter out jobs that weren't expected to run in this window
    const missed: string[] = [];
    const now = new Date();

    for (const row of rows) {
      if (!row.schedule) {
        // No cron expression — use expected_every_s only (original behavior)
        missed.push(row.job_name);
        continue;
      }

      try {
        // Check if the cron schedule had an occurrence within the expected_every_s window
        const windowStart = new Date(now.getTime() - row.expected_every_s * 1000);
        const interval = CronExpressionParser.parse(row.schedule, { currentDate: now });
        const prevRun = interval.prev().toDate();

        // If the most recent scheduled occurrence falls within the window, the job is missed
        if (prevRun >= windowStart) {
          missed.push(row.job_name);
        }
        // Otherwise (e.g., weekend for a M-F job), skip — not actually overdue
      } catch {
        // Invalid cron expression — fall back to flagging as missed
        missed.push(row.job_name);
      }
    }

    return missed;
  } finally {
    conn.release();
  }
}

/**
 * Find jobs that have a 'started' row but no subsequent 'success' or 'failed',
 * and have exceeded their max_runtime_s. Returns job names that appear stuck.
 */
export async function findStuckJobs(): Promise<string[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT cr.job_name
      FROM aardvark_cron_runs cr
      INNER JOIN aardvark_job_registry jr ON cr.job_name = jr.job_name
      WHERE cr.status = 'started'
        AND jr.active = 1
        AND jr.max_runtime_s IS NOT NULL
        AND cr.created_at < DATE_SUB(NOW(), INTERVAL jr.max_runtime_s SECOND)
        AND NOT EXISTS (
          SELECT 1 FROM aardvark_cron_runs cr2
          WHERE cr2.job_name = cr.job_name
            AND cr2.status IN ('success', 'failed')
            AND cr2.created_at > cr.created_at
        )
    `);
    return rows.map(r => r.job_name);
  } finally {
    conn.release();
  }
}

/** Get today's run summary: counts by status for each job. */
export async function getTodaySummary(): Promise<{ jobName: string; status: JobStatus; count: number }[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`
      SELECT job_name, status, COUNT(*) AS cnt
      FROM aardvark_cron_runs
      WHERE created_at >= CURDATE()
      GROUP BY job_name, status
      ORDER BY job_name, status
    `);
    return rows.map(r => ({
      jobName: r.job_name,
      status: r.status,
      count: r.cnt,
    }));
  } finally {
    conn.release();
  }
}
