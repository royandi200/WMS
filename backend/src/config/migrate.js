require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql2 = require('mysql2/promise');
const logger = require('./logger');

async function runMigration() {
  const conn = await mysql2.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });
  try {
    const schemaPath = path.join(__dirname, '../../../database/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await conn.query(sql);
    logger.info('✅ Migración ejecutada correctamente');
  } catch (err) {
    logger.error('❌ Error en migración:', err);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

runMigration();
