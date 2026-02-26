import { getPool } from './connection';
import type { RowDataPacket } from 'mysql2';

const SYSTEM_USERS = ['rdsadmin', 'mysql.sys', 'mysql.session', 'mysql.infoschema'];

export interface DbUser {
  user: string;
  host: string;
  grantLevel: string;
}

export function classifyGrants(grants: string[]): string {
  const joined = grants.join(' ').toUpperCase();
  if (joined.includes('ALL PRIVILEGES')) return 'admin';
  if (joined.includes('SELECT') && !joined.includes('INSERT') && !joined.includes('UPDATE')) return 'read-only';
  return 'custom';
}

// Use query() throughout — MySQL does not support prepared-statement
// placeholders in DDL statements (CREATE USER, GRANT, DROP USER, etc.).
// query() escapes values client-side.

export async function createUser(username: string, password: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query('CREATE USER ?@\'%\' IDENTIFIED BY ?', [username, password]);
    await conn.query('GRANT SELECT ON aardvark.* TO ?@\'%\'', [username]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

export async function removeUser(username: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query('DROP USER ?@\'%\'', [username]);
  } finally {
    conn.release();
  }
}

export async function changePassword(username: string, password: string): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query('ALTER USER ?@\'%\' IDENTIFIED BY ?', [username, password]);
    await conn.query('FLUSH PRIVILEGES');
  } finally {
    conn.release();
  }
}

export async function listUsers(): Promise<DbUser[]> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT user, host FROM mysql.user WHERE user NOT IN (?)',
      [SYSTEM_USERS],
    );

    const users: DbUser[] = [];
    for (const row of rows) {
      let grantLevel = 'unknown';
      try {
        const [grants] = await conn.query<RowDataPacket[]>('SHOW GRANTS FOR ?@?', [row.user, row.host]);
        const grantStrings = grants.map(g => Object.values(g)[0] as string);
        grantLevel = classifyGrants(grantStrings);
      } catch {
        // leave as 'unknown'
      }
      users.push({ user: row.user, host: row.host, grantLevel });
    }

    return users;
  } finally {
    conn.release();
  }
}
