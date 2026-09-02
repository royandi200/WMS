const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-repairs-qa-data';

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
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

function receiptNumber() {
  const argument = process.argv.find(value => value.startsWith('--receipt='));
  const value = String(argument?.slice('--receipt='.length) || '').trim();
  if (!/^REC-[A-Z0-9-]{3,50}$/u.test(value)) throw new Error('Usa --receipt=REC-...');
  return value;
}

async function main() {
  const number = receiptNumber();
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    await conn.beginTransaction();
    const [receipts] = await conn.execute(
      `SELECT id, numero, estado, completado_en, observaciones
         FROM recepciones WHERE numero = ? LIMIT 1 FOR UPDATE`,
      [number]
    );
    if (!receipts.length || receipts[0].estado !== 'completada' || !receipts[0].completado_en) {
      throw new Error('La recepcion no existe o no esta completada');
    }
    const receipt = receipts[0];
    const [groups] = await conn.execute(
      `SELECT recepcion_item_id, ubicacion_id, lote, condicion, cantidad,
              COUNT(*) AS total, MAX(id) AS keep_id
         FROM recepcion_distribuciones
        WHERE recepcion_id = ?
        GROUP BY recepcion_item_id, ubicacion_id, lote, condicion, cantidad
       HAVING COUNT(*) > 1`,
      [receipt.id]
    );
    const staleIds = [];
    for (const group of groups) {
      const [rows] = await conn.execute(
        `SELECT id, creado_en
           FROM recepcion_distribuciones
          WHERE recepcion_id = ? AND recepcion_item_id = ?
            AND ubicacion_id <=> ? AND lote = ? AND condicion = ? AND cantidad = ?
          ORDER BY creado_en DESC, id DESC`,
        [receipt.id, group.recepcion_item_id, group.ubicacion_id, group.lote,
         group.condicion, group.cantidad]
      );
      const keep = rows[0];
      const completionMs = new Date(receipt.completado_en).getTime();
      const keepAgeMs = completionMs - new Date(keep.creado_en).getTime();
      if (keepAgeMs < 0 || keepAgeMs > 60_000) {
        throw new Error(`La distribucion ${keep.id} no pertenece claramente a la confirmacion final`);
      }
      const stale = rows.slice(1);
      if (stale.some(row => completionMs - new Date(row.creado_en).getTime() <= 60_000)) {
        throw new Error(`Hay duplicados recientes ambiguos para el item ${group.recepcion_item_id}`);
      }
      staleIds.push(...stale.map(row => Number(row.id)));
    }
    if (!apply) {
      await conn.rollback();
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', receipt: number, staleIds, groups: groups.length }, null, 2));
      return;
    }
    if (!staleIds.length) {
      await conn.rollback();
      console.log(JSON.stringify({ ok: true, mode: 'nothing-to-repair', receipt: number }, null, 2));
      return;
    }
    const placeholders = staleIds.map(() => '?').join(', ');
    const [deleted] = await conn.execute(
      `DELETE FROM recepcion_distribuciones WHERE recepcion_id = ? AND id IN (${placeholders})`,
      [receipt.id, ...staleIds]
    );
    if (deleted.affectedRows !== staleIds.length) throw new Error('No se eliminaron exactamente las filas esperadas');

    const [reconciliation] = await conn.execute(
      `SELECT id, producto_id, cantidad_oc FROM recepcion_conciliacion_items WHERE recepcion_id = ? FOR UPDATE`,
      [receipt.id]
    );
    for (const row of reconciliation) {
      const [[accepted]] = await conn.execute(
        `SELECT COALESCE(SUM(x.cantidad), 0) AS cantidad
           FROM (
             SELECT ri.id,
                    CASE WHEN COUNT(rd.id) > 0
                         THEN COALESCE(SUM(CASE WHEN rd.condicion = 'DISPONIBLE' THEN rd.cantidad ELSE 0 END), 0)
                         ELSE LEAST(ri.cantidad_rec, ri.cantidad_esp) END AS cantidad
               FROM recepciones r
               JOIN recepcion_items ri ON ri.recepcion_id = r.id
               LEFT JOIN recepcion_distribuciones rd
                 ON rd.recepcion_id = r.id AND rd.recepcion_item_id = ri.id
              WHERE r.orden_compra_id = (SELECT orden_compra_id FROM recepciones WHERE id = ?)
                AND r.estado <> 'anulada' AND ri.producto_id = ?
              GROUP BY ri.id, ri.cantidad_rec, ri.cantidad_esp
           ) x`,
        [receipt.id, row.producto_id]
      );
      const quantity = Number(accepted.cantidad || 0);
      const pending = Math.max(Number(row.cantidad_oc) - quantity, 0);
      await conn.execute(
        `UPDATE recepcion_conciliacion_items
            SET cantidad_aceptada_acumulada = ?, saldo_oc = ? WHERE id = ?`,
        [quantity, pending, row.id]
      );
    }
    const [[issues]] = await conn.execute(
      'SELECT COUNT(*) AS total FROM recepcion_novedades WHERE recepcion_id = ?',
      [receipt.id]
    );
    if (Number(issues.total) === 0) {
      const observations = String(receipt.observaciones || '')
        .split('\n')
        .filter(line => !line.startsWith('Diferencia fisica registrada en recepcion_novedades '))
        .join('\n') || null;
      await conn.execute('UPDATE recepciones SET observaciones = ? WHERE id = ?', [observations, receipt.id]);
    }
    await conn.commit();
    console.log(JSON.stringify({ ok: true, mode: 'applied', receipt: number, deletedIds: staleIds }, null, 2));
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
