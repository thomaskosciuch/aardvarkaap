const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (pool) return pool;

  const secret = JSON.parse(process.env.DB_SECRET || '{}');

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

module.exports = { getPool };
