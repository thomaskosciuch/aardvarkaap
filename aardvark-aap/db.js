const mysql = require('mysql2/promise');

let pool = null;

/**
 * Parse DB_SECRET from AWS Secrets Manager and create a connection pool.
 * DB_SECRET is a JSON string with: username, password, host, port, dbname
 */
function getPool() {
  if (pool) return pool;

  const secret = process.env.DB_SECRET;
  if (!secret) {
    throw new Error('DB_SECRET environment variable is not set');
  }

  const config = JSON.parse(secret);

  pool = mysql.createPool({
    host: config.host,
    port: config.port || 3306,
    user: config.username,
    password: config.password,
    database: config.dbname || 'aardvark',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  return pool;
}

/**
 * Initialize the database schema (create tables if they don't exist).
 */
async function init() {
  const db = getPool();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ip_whitelist (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ip_address VARCHAR(45) NOT NULL,
      whitelisted_by VARCHAR(255) NOT NULL,
      slack_user_id VARCHAR(64) NOT NULL,
      whitelisted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_ip (ip_address)
    )
  `);

  console.log('Database schema initialized');
}

/**
 * Run a query using the connection pool.
 */
async function query(sql, params = []) {
  const db = getPool();
  const [rows] = await db.execute(sql, params);
  return rows;
}

module.exports = { getPool, init, query };
