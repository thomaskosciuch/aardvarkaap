import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

let pool: Pool | null = null;

interface DbSecret {
  host: string;
  port?: number;
  username: string;
  password: string;
  dbname?: string;
}

export function getPool(): Pool {
  if (pool) return pool;

  const secret: DbSecret = JSON.parse(process.env.DB_SECRET || '{}');

  pool = mysql.createPool({
    host: secret.host,
    port: secret.port || 3306,
    user: secret.username,
    password: secret.password,
    database: secret.dbname || 'aardvark',
    waitForConnections: true,
    connectionLimit: 5,
  });

  return pool;
}
