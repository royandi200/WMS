const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const ORDER_NUMBER = 'DEMO-20260902-DOC-IO-001';
const SKU = '00276-PTZNASHWA';
const LOT = 'DEMO-IO-ZENOVA-001';
const EXPIRY = '2027-11-30';
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-qa-document-evidence';

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [path.join(__dirname, '..', '..', '.env'), path.join(__dirname, '..', '..', '..', '.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function connectionConfig() {
  loadEnvFile();
  return {
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

async function loadTarget(conn, lock = false) {
  const [rows] = await conn.execute(
    `SELECT oci.id, oc.id AS orden_compra_id, oc.estado, p.modalidad_operativa,
            p.requiere_lote, oci.cantidad_ordenada, oci.lote_documento,
            DATE_FORMAT(oci.fecha_vencimiento_documento, '%Y-%m-%d') AS fecha_vencimiento_documento,
            EXISTS (
              SELECT 1 FROM recepciones r
               WHERE r.orden_compra_id = oc.id AND r.estado = 'completada'
            ) AS recepcion_completada
       FROM orden_compra_proveedor_items oci
       JOIN ordenes_compra_proveedor oc ON oc.id = oci.orden_compra_id
       JOIN productos p ON p.id = oci.producto_id
      WHERE oc.numero = ? AND p.siigo_code = ?${lock ? ' FOR UPDATE' : ''}`,
    [ORDER_NUMBER, SKU]
  );
  if (rows.length !== 1) throw new Error(`Se esperaba una sola linea ${ORDER_NUMBER}/${SKU}`);
  return rows[0];
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await loadTarget(conn);
    if (before.modalidad_operativa !== 'IO' || !Number(before.requiere_lote)) {
      throw new Error('El producto demo ya no es IO con control de lote');
    }
    if (Number(before.cantidad_ordenada) !== 5) throw new Error('La cantidad demo ya no es 5');
    if (Number(before.recepcion_completada)) throw new Error('La recepcion demo ya fue completada');
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before, proposed: { lot: LOT, expiry: EXPIRY } }, null, 2));
      return;
    }
    await conn.beginTransaction();
    const locked = await loadTarget(conn, true);
    if (Number(locked.recepcion_completada)) throw new Error('La recepcion demo fue completada durante la operacion');
    await conn.execute(
      `UPDATE orden_compra_proveedor_items
          SET lote_documento = ?, fecha_vencimiento_documento = ?
        WHERE id = ?`,
      [LOT, EXPIRY, locked.id]
    );
    await conn.commit();
    console.log(JSON.stringify({ ok: true, mode: 'applied', after: await loadTarget(conn) }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
