import { getPool } from './connection';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type Severity = 'low' | 'medium' | 'high';

export interface Job {
  jobName: string;
  description: string | null;
  schedule: string | null;
  expectedEveryS: number;
  maxRuntimeS: number | null;
  manualTriggerUrl: string | null;
  severity: Severity;
  alertChannelId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegisterJobInput {
  jobName: string;
  description?: string;
  schedule?: string;
  expectedEveryS: number;
  maxRuntimeS?: number;
  manualTriggerUrl?: string;
  severity?: Severity;
  alertChannelId?: string;
}

export interface UpdateJobInput {
  description?: string;
  schedule?: string;
  expectedEveryS?: number;
  maxRuntimeS?: number | null;
  manualTriggerUrl?: string | null;
  severity?: Severity;
  alertChannelId?: string | null;
  active?: boolean;
}

function rowToJob(row: RowDataPacket): Job {
  return {
    jobName: row.job_name,
    description: row.description,
    schedule: row.schedule,
    expectedEveryS: row.expected_every_s,
    maxRuntimeS: row.max_runtime_s,
    manualTriggerUrl: row.manual_trigger_url,
    severity: row.severity,
    alertChannelId: row.alert_channel_id,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function registerJob(input: RegisterJobInput): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO aardvark_job_registry
        (job_name, description, schedule, expected_every_s, max_runtime_s, manual_trigger_url, severity, alert_channel_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.jobName,
        input.description ?? null,
        input.schedule ?? null,
        input.expectedEveryS,
        input.maxRuntimeS ?? null,
        input.manualTriggerUrl ?? null,
        input.severity ?? 'medium',
        input.alertChannelId ?? null,
      ],
    );
  } finally {
    conn.release();
  }
}

export async function updateJob(jobName: string, input: UpdateJobInput): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.description !== undefined)      { sets.push('description = ?');        values.push(input.description); }
  if (input.schedule !== undefined)          { sets.push('schedule = ?');            values.push(input.schedule); }
  if (input.expectedEveryS !== undefined)    { sets.push('expected_every_s = ?');    values.push(input.expectedEveryS); }
  if (input.maxRuntimeS !== undefined)       { sets.push('max_runtime_s = ?');       values.push(input.maxRuntimeS); }
  if (input.manualTriggerUrl !== undefined)  { sets.push('manual_trigger_url = ?');  values.push(input.manualTriggerUrl); }
  if (input.severity !== undefined)          { sets.push('severity = ?');            values.push(input.severity); }
  if (input.alertChannelId !== undefined)    { sets.push('alert_channel_id = ?');    values.push(input.alertChannelId); }
  if (input.active !== undefined)            { sets.push('active = ?');              values.push(input.active ? 1 : 0); }

  if (sets.length === 0) return;

  values.push(jobName);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query<ResultSetHeader>(
      `UPDATE aardvark_job_registry SET ${sets.join(', ')} WHERE job_name = ?`,
      values,
    );
    if (result.affectedRows === 0) {
      throw new Error(`Job '${jobName}' not found`);
    }
  } finally {
    conn.release();
  }
}

export async function getJob(jobName: string): Promise<Job | null> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT * FROM aardvark_job_registry WHERE job_name = ?',
      [jobName],
    );
    return rows.length > 0 ? rowToJob(rows[0]) : null;
  } finally {
    conn.release();
  }
}

export async function listJobs(activeOnly = true): Promise<Job[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const sql = activeOnly
      ? 'SELECT * FROM aardvark_job_registry WHERE active = 1 ORDER BY job_name'
      : 'SELECT * FROM aardvark_job_registry ORDER BY job_name';
    const [rows] = await conn.query<RowDataPacket[]>(sql);
    return rows.map(rowToJob);
  } finally {
    conn.release();
  }
}

export async function deactivateJob(jobName: string): Promise<void> {
  await updateJob(jobName, { active: false });
}

export async function deleteJob(jobName: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query<ResultSetHeader>(
      'DELETE FROM aardvark_job_registry WHERE job_name = ?',
      [jobName],
    );
    if (result.affectedRows === 0) {
      throw new Error(`Job '${jobName}' not found`);
    }
  } finally {
    conn.release();
  }
}
