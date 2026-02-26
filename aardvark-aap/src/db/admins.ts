import { getPool } from './connection';
import type { RowDataPacket } from 'mysql2';

export interface Admin {
  slackUserId: string;
  isSuperAdmin: boolean;
  addedAt: Date;
}

/** Create the admins table if it doesn't already exist. */
export async function initAdminsTable(): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS admins (
        slack_user_id VARCHAR(20) NOT NULL PRIMARY KEY,
        is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
        added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } finally {
    conn.release();
  }
}

/** Seed initial admins on first run (no-op if table already has rows). */
export async function seedAdmins(): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS cnt FROM admins');
    if (rows[0].cnt > 0) return;

    // Matt = super-admin
    await conn.query(
      'INSERT IGNORE INTO admins (slack_user_id, is_super_admin) VALUES (?, 1)',
      ['U01J9R9DR9N'],
    );

    // Regular admins
    const regularAdmins = ['U0362BDQQM6', 'D045ML2P2K1', 'D037GHGD2BY', 'D08N6HJA8US'];
    for (const userId of regularAdmins) {
      await conn.query(
        'INSERT IGNORE INTO admins (slack_user_id, is_super_admin) VALUES (?, 0)',
        [userId],
      );
    }
  } finally {
    conn.release();
  }
}

export async function isAdmin(slackUserId: string): Promise<boolean> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT 1 FROM admins WHERE slack_user_id = ?',
      [slackUserId],
    );
    return rows.length > 0;
  } finally {
    conn.release();
  }
}

export async function isSuperAdmin(slackUserId: string): Promise<boolean> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT 1 FROM admins WHERE slack_user_id = ? AND is_super_admin = 1',
      [slackUserId],
    );
    return rows.length > 0;
  } finally {
    conn.release();
  }
}

export async function listAdmins(): Promise<Admin[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT slack_user_id, is_super_admin, added_at FROM admins ORDER BY is_super_admin DESC, added_at ASC',
    );
    return rows.map(row => ({
      slackUserId: row.slack_user_id,
      isSuperAdmin: Boolean(row.is_super_admin),
      addedAt: row.added_at,
    }));
  } finally {
    conn.release();
  }
}

export async function addAdmin(slackUserId: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(
      'INSERT INTO admins (slack_user_id, is_super_admin) VALUES (?, 0)',
      [slackUserId],
    );
  } finally {
    conn.release();
  }
}

export async function removeAdmin(slackUserId: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT is_super_admin FROM admins WHERE slack_user_id = ?',
      [slackUserId],
    );
    if (rows.length === 0) {
      throw new Error('User is not an admin');
    }
    if (rows[0].is_super_admin) {
      throw new Error('Cannot remove a super-admin');
    }
    await conn.query('DELETE FROM admins WHERE slack_user_id = ?', [slackUserId]);
  } finally {
    conn.release();
  }
}
