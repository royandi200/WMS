const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  for (const line of fs.readFileSync(path.resolve(__dirname, '../../../.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const { reportWaste } = require('../../api/_lib/waste-workflow');

async function expectStatus(work, status) {
  try {
    await work();
  } catch (error) {
    if (error.status === status) return error.message;
    throw error;
  }
  throw new Error(`Se esperaba rechazo HTTP ${status}`);
}

async function main() {
  const conn = await createConnection();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const lot = `WMSFLOW-WASTE-${suffix}`;
  const reference = `WMSFLOW-WASTE-${suffix}`;
  let wasteId = null;
  try {
    const [products] = await conn.execute(
      `SELECT id, siigo_code FROM productos WHERE siigo_code = 'WMSQA260721P01' LIMIT 1`
    );
    const [locations] = await conn.execute(
      `SELECT u.id, u.codigo, u.bodega_id
       FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
       WHERE u.codigo = 'PPAL-A-1-01' AND u.activa = 1 AND b.activa = 1 LIMIT 1`
    );
    if (!products.length || !locations.length) throw new Error('Faltan fixture de producto o ubicacion QA');
    const product = products[0];
    const location = locations[0];
    const lotId = crypto.randomUUID();

    await conn.execute(
      `INSERT INTO lots
         (id, lpn, product_id, bodega_id, qty_initial, qty_current, origin, status, notes)
       VALUES (?, ?, ?, ?, 1, 1, 'AJUSTE', 'DISPONIBLE', 'QA temporal de integridad de mermas')`,
      [lotId, lot, product.id, location.bodega_id]
    );
    await conn.execute(
      `INSERT INTO stock
         (producto_id, bodega_id, ubicacion_id, lote, cantidad, reservada)
       VALUES (?, ?, ?, ?, 1, 0.5)`,
      [product.id, location.bodega_id, location.id, lot]
    );

    const wrongLocation = await expectStatus(() => reportWaste({
      referencia_merma: `${reference}-BAD-LOC`, id_item: product.siigo_code,
      id_lote: lot, ubicacion: 'NO-EXISTE', cantidad: 0.1, motivo: 'QA',
    }, 1), 409);
    const reservedProtection = await expectStatus(() => reportWaste({
      referencia_merma: `${reference}-EXCESS`, id_item: product.siigo_code,
      id_lote: lot, ubicacion: location.codigo, cantidad: 0.75, motivo: 'QA',
    }, 1), 409);

    const created = await reportWaste({
      referencia_merma: reference, id_item: product.siigo_code,
      id_lote: lot, ubicacion: location.codigo, cantidad: 0.25,
      motivo: 'QA transaccional controlada',
    }, 1);
    wasteId = created.id;
    const replay = await reportWaste({
      referencia_merma: reference, id_item: product.siigo_code,
      id_lote: lot, ubicacion: location.codigo, cantidad: 0.25,
      motivo: 'QA transaccional controlada',
    }, 1);
    const referenceConflict = await expectStatus(() => reportWaste({
      referencia_merma: reference, id_item: product.siigo_code,
      id_lote: lot, ubicacion: location.codigo, cantidad: 0.1,
      motivo: 'QA con datos diferentes',
    }, 1), 409);

    const [balances] = await conn.execute(
      `SELECT s.cantidad, s.reservada, l.qty_current
       FROM stock s JOIN lots l ON l.lpn = s.lote
       WHERE s.lote = ? AND s.ubicacion_id = ?`,
      [lot, location.id]
    );
    const [counts] = await conn.execute(
      `SELECT
         (SELECT COUNT(*) FROM mermas WHERE referencia_externa = ?) AS waste_count,
         (SELECT COUNT(*) FROM movimientos WHERE referencia_tipo = 'merma_bodega' AND referencia_id = ?) AS movement_count,
         (SELECT COUNT(*) FROM kardex WHERE reference = ?) AS kardex_count`,
      [reference, wasteId, `merma:${created.numero}`]
    );
    const balance = balances[0];
    if (!replay.already_completed
        || Number(balance.cantidad) !== 0.75
        || Number(balance.reservada) !== 0.5
        || Number(balance.qty_current) !== 0.75
        || Number(counts[0].waste_count) !== 1
        || Number(counts[0].movement_count) !== 1
        || Number(counts[0].kardex_count) !== 1) {
      throw new Error('La merma no concilia o el reintento duplico movimientos');
    }

    console.log(JSON.stringify({
      created, replaySafe: true, referenceConflict, wrongLocation, reservedProtection,
      final: balance, records: counts[0],
    }, null, 2));
  } finally {
    if (wasteId) {
      const [rows] = await conn.execute('SELECT numero FROM mermas WHERE id = ?', [wasteId]);
      if (rows.length) await conn.execute('DELETE FROM kardex WHERE reference = ?', [`merma:${rows[0].numero}`]);
      await conn.execute("DELETE FROM movimientos WHERE referencia_tipo = 'merma_bodega' AND referencia_id = ?", [wasteId]);
      await conn.execute('DELETE FROM mermas WHERE id = ?', [wasteId]);
    }
    await conn.execute('DELETE FROM stock WHERE lote = ?', [lot]);
    await conn.execute('DELETE FROM lots WHERE lpn = ?', [lot]);
    await conn.end();
  }
}

main().catch((error) => { console.error(`${error.code || 'ERROR'}: ${error.message}`); process.exit(1); });
