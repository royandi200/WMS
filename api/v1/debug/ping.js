// api/v1/debug/ping.js — TEMPORAL, borrar después del diagnóstico
const mysql = require('mysql2/promise');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const report = {
    timestamp: new Date().toISOString(),
    env: {
      DB_HOST:    process.env.DB_HOST     ? '✅ definida' : '❌ FALTA',
      DB_PORT:    process.env.DB_PORT     ? '✅ ' + process.env.DB_PORT : '⚠️ usando 3306',
      DB_USER:    process.env.DB_USER     ? '✅ definida' : '❌ FALTA',
      DB_PASSWORD:process.env.DB_PASSWORD ? '✅ definida' : '❌ FALTA',
      DB_NAME:    process.env.DB_NAME     ? '✅ ' + process.env.DB_NAME : '❌ FALTA',
      JWT_SECRET: process.env.JWT_SECRET  ? '✅ definida (' + process.env.JWT_SECRET.length + ' chars)' : '❌ FALTA',
    },
    db: null,
    tables: null,
    usuarios_count: null,
    error: null,
  };

  try {
    const conn = await mysql.createConnection({
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT || '3306'),
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 8000,
    });

    // Ping
    await conn.ping();
    report.db = '✅ Conectado a ' + process.env.DB_NAME;

    // Listar tablas
    const [tables] = await conn.execute('SHOW TABLES');
    report.tables = tables.map(t => Object.values(t)[0]);

    // Contar usuarios si existe la tabla
    if (report.tables.includes('usuarios')) {
      const [rows] = await conn.execute('SELECT COUNT(*) as total FROM usuarios');
      report.usuarios_count = rows[0].total;
    } else {
      report.usuarios_count = '❌ tabla usuarios NO existe';
    }

    await conn.end();
  } catch (err) {
    report.db = '❌ Fallo';
    report.error = err.message;
  }

  return res.status(200).json(report);
};
