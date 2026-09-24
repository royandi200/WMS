const fs = require('node:fs');
const path = require('node:path');
const { createConnection } = require('../../api/_lib/db');

const TARGET = Object.freeze({
  id: 47,
  number: 'MER-3A98FF67',
  orderId: 97,
  sku: '00017-ETASH60',
  quantity: 1,
  previousReason: 'merma',
  correctedReason: 'Prueba controlada; causa física no especificada',
});

function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) throw new Error('No se encontró el archivo de conexión');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const matched = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
    if (!matched) continue;
    process.env[matched[1]] ||= matched[2].trim().replace(/^['"]|['"]$/g, '');
  }
  for (const [dbKey, mysqlKey] of [
    ['DB_HOST', 'MYSQL_HOST'], ['DB_PORT', 'MYSQL_PORT'], ['DB_USER', 'MYSQL_USER'],
    ['DB_PASSWORD', 'MYSQL_PASSWORD'], ['DB_NAME', 'MYSQL_DATABASE'],
  ]) process.env[dbKey] ||= process.env[mysqlKey];
}

async function main() {
  const apply = process.argv.includes('--apply');
  loadEnv();
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT m.id, m.numero, m.orden_produccion_id, m.cantidad, m.motivo,
              m.estado, m.tipo, p.siigo_code AS sku
         FROM mermas m JOIN productos p ON p.id = m.producto_id
        WHERE m.id = ? AND m.numero = ? LIMIT 1 FOR UPDATE`,
      [TARGET.id, TARGET.number]
    );
    const row = rows[0];
    if (!row || Number(row.orden_produccion_id) !== TARGET.orderId
      || row.sku !== TARGET.sku || Number(row.cantidad) !== TARGET.quantity
      || row.motivo !== TARGET.previousReason || row.estado !== 'APROBADO'
      || row.tipo !== 'PROCESO') {
      throw new Error('La merma ya no coincide con el estado validado; no se corrigió');
    }
    if (apply) {
      const [updated] = await conn.execute(
        `UPDATE mermas SET motivo = ? WHERE id = ? AND motivo = ?`,
        [TARGET.correctedReason, TARGET.id, TARGET.previousReason]
      );
      if (updated.affectedRows !== 1) throw new Error('La corrección no afectó exactamente una merma');
      await conn.execute(
        `INSERT INTO system_logs (nivel, modulo, mensaje, usuario_id, payload, created_at)
         VALUES ('INFO', 'mermas', ?, NULL, ?, NOW())`,
        [`Corrección de motivo de prueba en ${TARGET.number}, solicitada por el usuario`,
          JSON.stringify({ wasteId: TARGET.id, orderId: TARGET.orderId,
            sku: TARGET.sku, before: TARGET.previousReason, after: TARGET.correctedReason })]
      );
      await conn.commit();
    } else {
      await conn.rollback();
    }
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'applied' : 'dry-run',
      number: TARGET.number, orderId: TARGET.orderId, sku: TARGET.sku,
      quantity: TARGET.quantity, previousReason: TARGET.previousReason,
      correctedReason: TARGET.correctedReason })}\n`);
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
