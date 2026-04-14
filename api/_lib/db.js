// api/_lib/db.js — conexión MySQL2 sin pool persistente (compatible Vercel serverless)
const mysql = require('mysql2/promise');

let _conn = null;

async function getConnection() {
  if (_conn) {
    try { await _conn.ping(); return _conn; } catch { _conn = null; }
  }
  _conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  return _conn;
}

async function query(sql, params = []) {
  const conn = await getConnection();
  const [rows] = await conn.execute(sql, params);
  return rows;
}

module.exports = { query };
