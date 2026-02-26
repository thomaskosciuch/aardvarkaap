import { getPool } from './connection';
import type { RowDataPacket } from 'mysql2';

export interface ActivityEntry {
  id: number;
  jobName: string | null;
  eventType: string;
  actor: string | null;
  detail: string | null;
  createdAt: Date;
}

export interface LogActivityInput {
  jobName?: string;
  eventType: string;
  actor?: string;
  detail?: string;
}

function rowToEntry(row: RowDataPacket): ActivityEntry {
  return {
    id: row.id,
    jobName: row.job_name,
    eventType: row.event_type,
    actor: row.actor,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

/** Append an activity event. */
export async function logActivity(input: LogActivityInput): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO aardvark_activity_log (job_name, event_type, actor, detail)
       VALUES (?, ?, ?, ?)`,
      [
        input.jobName ?? null,
        input.eventType,
        input.actor ?? null,
        input.detail ?? null,
      ],
    );
  } finally {
    conn.release();
  }
}

/** Get recent activity across all jobs. */
export async function getRecentActivity(limit = 50): Promise<ActivityEntry[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_activity_log ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map(rowToEntry);
  } finally {
    conn.release();
  }
}

/** Get activity for a specific job. */
export async function getActivityForJob(jobName: string, limit = 20): Promise<ActivityEntry[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_activity_log WHERE job_name = ? ORDER BY created_at DESC LIMIT ?',
      [jobName, limit],
    );
    return rows.map(rowToEntry);
  } finally {
    conn.release();
  }
}

/** Get activity by a specific actor. */
export async function getActivityByActor(actor: string, limit = 20): Promise<ActivityEntry[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_activity_log WHERE actor = ? ORDER BY created_at DESC LIMIT ?',
      [actor, limit],
    );
    return rows.map(rowToEntry);
  } finally {
    conn.release();
  }
}
