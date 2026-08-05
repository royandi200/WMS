// api/_lib/db.js — conexión MySQL2 sin pool persistente (compatible Vercel serverless)
const mysql = require('mysql2/promise');

let _conn = null;

function connectionConfig() {
  return {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 10000,
    // MySQL DATETIME values are warehouse-local. Pin their interpretation so
    // Vercel (UTC) and local development produce the same instant.
    timezone: process.env.DB_TIMEZONE || '-05:00',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

async function createConnection() {
  return mysql.createConnection(connectionConfig());
}

async function getConnection() {
  if (_conn) {
    try { await _conn.ping(); return _conn; } catch { _conn = null; }
  }
  _conn = await createConnection();
  return _conn;
}

async function query(sql, params = []) {
  const conn = await getConnection();
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function withTransaction(work) {
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const txQuery = async (sql, params = []) => {
      const [rows] = await conn.query(sql, params);
      return rows;
    };
    const result = await work(txQuery, conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    try { await conn.end(); } catch {}
  }
}

module.exports = { query, withTransaction, createConnection, connectionConfig };
