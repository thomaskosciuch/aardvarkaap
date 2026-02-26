import { getPool } from './connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Maintainer {
  id: number;
  jobName: string;
  slackUserId: string;
  addedBy: string | null;
  createdAt: Date;
}

/** Add a maintainer to a job. */
export async function addMaintainer(jobName: string, slackUserId: string, addedBy?: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(
      'INSERT INTO aardvark_job_maintainers (job_name, slack_user_id, added_by) VALUES (?, ?, ?)',
      [jobName, slackUserId, addedBy ?? null],
    );
  } finally {
    conn.release();
  }
}

/** Remove a maintainer from a job. */
export async function removeMaintainer(jobName: string, slackUserId: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query<ResultSetHeader>(
      'DELETE FROM aardvark_job_maintainers WHERE job_name = ? AND slack_user_id = ?',
      [jobName, slackUserId],
    );
    if (result.affectedRows === 0) {
      throw new Error(`Maintainer '${slackUserId}' not found for job '${jobName}'`);
    }
  } finally {
    conn.release();
  }
}

/** List all maintainers for a specific job. */
export async function listMaintainersForJob(jobName: string): Promise<Maintainer[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_job_maintainers WHERE job_name = ? ORDER BY created_at',
      [jobName],
    );
    return rows.map(row => ({
      id: row.id,
      jobName: row.job_name,
      slackUserId: row.slack_user_id,
      addedBy: row.added_by,
      createdAt: row.created_at,
    }));
  } finally {
    conn.release();
  }
}

/** Set the full maintainer list for a job (replace all). */
export async function setMaintainers(jobName: string, slackUserIds: string[], addedBy?: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM aardvark_job_maintainers WHERE job_name = ?', [jobName]);
    for (const userId of slackUserIds) {
      await conn.query(
        'INSERT INTO aardvark_job_maintainers (job_name, slack_user_id, added_by) VALUES (?, ?, ?)',
        [jobName, userId, addedBy ?? null],
      );
    }
  } finally {
    conn.release();
  }
}

/**
 * Get all maintainer Slack user IDs for a job.
 * Convenience wrapper for the alerting pipeline.
 */
export async function getMaintainerIds(jobName: string): Promise<string[]> {
  const maintainers = await listMaintainersForJob(jobName);
  return maintainers.map(m => m.slackUserId);
}
