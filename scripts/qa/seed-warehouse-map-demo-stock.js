const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const manifest = require('../../database/warehouse_positions_master.json');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-qa-inventory';
const REFERENCE_TYPE = 'qa_warehouse_map_seed';

const DEMO_STOCK = [
  { location: 'A1', sku: '00004-TPALB', quantity: 180 },
  { location: 'A11', sku: '00006-TRP', quantity: 240 },
  { location: 'A14', sku: '00035-LNTP60', quantity: 240 },
  { location: 'B13', sku: '00276-PTZNASHWA', quantity: 24 },
  { location: 'B16', sku: '00051-MPASH', quantity: 5000 },
  { location: 'B18', sku: '00007-TRG', quantity: 240 },
  { location: 'C2', sku: '00102-PTASH60', quantity: 48 },
  { location: 'C13', sku: '00110-PTCG120', quantity: 48 },
  { location: 'C17', sku: '00040-CMV', quantity: 30 },
  { location: 'D4', sku: '00038-CJ12', quantity: 40 },
  { location: 'D5', sku: '00042-CMCG', quantity: 30 },
  { location: 'D24', sku: '00040-CMV', quantity: 20 },
];

function loadEnvFile() {
  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env'),
  ];
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
    connectTimeout: 15000,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

function documentedSkuForLocation(location, sku) {
  const documented = manifest.assignments?.[location] || [];
  return documented.some(candidate => (manifest.canonical_sku_overrides?.[candidate] || candidate) === sku);
}

function lotCode(item) {
  return `DEMO-MAPA-${item.location}-${item.sku}`;
}

async function inspect(conn, lock = false) {
  const [[warehouse]] = await conn.execute(
    'SELECT id, codigo, nombre FROM bodegas WHERE codigo = ? AND activa = 1 LIMIT 1',
    [manifest.warehouse_code]
  );
  if (!warehouse) throw new Error(`No existe la bodega activa ${manifest.warehouse_code}`);

  const [[actor]] = await conn.execute(
    `SELECT u.id, u.nombre
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1 AND r.nombre = 'admin'
      ORDER BY u.id LIMIT 1`
  );
  if (!actor) throw new Error('No existe un usuario administrador activo para auditar el ajuste');

  const skus = [...new Set(DEMO_STOCK.map(item => item.sku))];
  const locations = [...new Set(DEMO_STOCK.map(item => item.location))];
  const [products] = await conn.execute(
    `SELECT id, siigo_code, nombre, unit_label, requiere_lote, activo
       FROM productos WHERE siigo_code IN (${skus.map(() => '?').join(',')})`,
    skus
  );
  const [locationRows] = await conn.execute(
    `SELECT id, codigo, zona, pasillo, nivel, posicion, activa
       FROM ubicaciones
      WHERE bodega_id = ? AND codigo IN (${locations.map(() => '?').join(',')})`,
    [warehouse.id, ...locations]
  );
  const productsBySku = new Map(products.map(product => [product.siigo_code, product]));
  const locationsByCode = new Map(locationRows.map(location => [location.codigo, location]));

  const missingProducts = skus.filter(sku => !productsBySku.has(sku));
  const inactiveProducts = products.filter(product => !Number(product.activo)).map(product => product.siigo_code);
  const missingLocations = locations.filter(location => !locationsByCode.has(location));
  const inactiveLocations = locationRows.filter(location => !Number(location.activa)).map(location => location.codigo);
  const invalidAssignments = DEMO_STOCK
    .filter(item => !documentedSkuForLocation(item.location, item.sku))
    .map(item => `${item.location}:${item.sku}`);
  if (missingProducts.length || inactiveProducts.length || missingLocations.length || inactiveLocations.length || invalidAssignments.length) {
    throw new Error(JSON.stringify({
      missingProducts,
      inactiveProducts,
      missingLocations,
      inactiveLocations,
      invalidAssignments,
    }));
  }

  const rows = [];
  for (const fixture of DEMO_STOCK) {
    const product = productsBySku.get(fixture.sku);
    const location = locationsByCode.get(fixture.location);
    const lpn = lotCode(fixture);
    const suffix = lock ? ' FOR UPDATE' : '';
    const [stockRows] = await conn.execute(
      `SELECT id, cantidad, reservada FROM stock
        WHERE producto_id = ? AND bodega_id = ? AND ubicacion_id = ? AND lote = ?${suffix}`,
      [product.id, warehouse.id, location.id, lpn]
    );
    if (stockRows.length > 1) throw new Error(`Hay saldos duplicados para ${lpn}`);
    const [lotRows] = await conn.execute(
      `SELECT id, qty_initial, qty_current, status FROM lots WHERE lpn = ?${suffix}`,
      [lpn]
    );
    if (lotRows.length > 1) throw new Error(`Hay lotes duplicados para ${lpn}`);
    if (stockRows[0] && Number(stockRows[0].reservada) !== 0) {
      throw new Error(`El saldo demostrativo ${lpn} tiene unidades reservadas`);
    }
    rows.push({
      ...fixture,
      lpn,
      productId: Number(product.id),
      productName: product.nombre,
      unit: product.unit_label || 'und',
      requiresLot: Boolean(Number(product.requiere_lote)),
      locationId: Number(location.id),
      stockId: stockRows[0]?.id ? Number(stockRows[0].id) : null,
      lotId: lotRows[0]?.id || null,
      currentStock: Number(stockRows[0]?.cantidad || 0),
      currentLot: Number(lotRows[0]?.qty_current || 0),
      delta: fixture.quantity - Number(stockRows[0]?.cantidad || 0),
    });
  }
  return { warehouse, actor, rows };
}

async function applyFixtures(conn, inspection) {
  for (const item of inspection.rows) {
    const expiry = item.requiresLot ? '2027-12-31' : null;
    const lotId = item.lotId || crypto.randomUUID();
    if (item.lotId) {
      await conn.execute(
        `UPDATE lots
            SET product_id = ?, bodega_id = ?, qty_initial = ?, qty_current = ?,
                origin = 'AJUSTE', status = 'DISPONIBLE', expiry_date = ?,
                notes = 'Stock demostrativo del plano de bodega', updated_at = NOW()
          WHERE id = ?`,
        [item.productId, inspection.warehouse.id, item.quantity, item.quantity, expiry, lotId]
      );
    } else {
      await conn.execute(
        `INSERT INTO lots
           (id, lpn, product_id, bodega_id, qty_initial, qty_current, origin,
            status, received_by, notes, expiry_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'AJUSTE', 'DISPONIBLE', ?,
                 'Stock demostrativo del plano de bodega', ?, NOW(), NOW())`,
        [lotId, item.lpn, item.productId, inspection.warehouse.id, item.quantity,
         item.quantity, inspection.actor.id, expiry]
      );
    }

    if (item.stockId) {
      await conn.execute(
        `UPDATE stock SET cantidad = ?, reservada = 0, fecha_venc = ?, actualizado_en = NOW()
          WHERE id = ?`,
        [item.quantity, expiry, item.stockId]
      );
    } else {
      await conn.execute(
        `INSERT INTO stock
           (producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
        [item.productId, inspection.warehouse.id, item.locationId, item.lpn, expiry, item.quantity]
      );
    }

    if (Math.abs(item.delta) > 0.000001) {
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_orig, bodega_dest, ubicacion_orig, ubicacion_dest,
            lote, cantidad, referencia_tipo, usuario_id, siigo_sync, creado_en)
         VALUES ('ajuste', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
        [item.productId,
         item.delta < 0 ? inspection.warehouse.id : null,
         item.delta > 0 ? inspection.warehouse.id : null,
         item.delta < 0 ? item.locationId : null,
         item.delta > 0 ? item.locationId : null,
         item.lpn, item.delta, REFERENCE_TYPE, inspection.actor.id]
      );
      const [[balance]] = await conn.execute(
        'SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE producto_id = ? AND bodega_id = ?',
        [item.productId, inspection.warehouse.id]
      );
      await conn.execute(
        `INSERT INTO kardex
           (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
            reference, notes, approved_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'AJUSTE_DEMO_MAPA', ?, ?, ?, ?, ?, NOW())`,
        [crypto.randomUUID(), crypto.randomUUID(), lotId, item.productId,
         inspection.actor.id, item.delta, Number(balance.total),
         `qa-map:${item.lpn}`,
         `Stock demostrativo en ${item.location}; no sincronizar con Siigo`,
         inspection.actor.id]
      );
    }
  }

  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES ('qa_warehouse_map', 'INFO', 'Stock demostrativo del plano actualizado', ?, ?, NOW())`,
    [inspection.actor.id, JSON.stringify({
      reference_type: REFERENCE_TYPE,
      fixtures: inspection.rows.map(item => ({
        location: item.location,
        sku: item.sku,
        quantity: item.quantity,
        lpn: item.lpn,
      })),
    })]
  );
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    await conn.beginTransaction();
    const before = await inspect(conn, apply);
    if (apply) await applyFixtures(conn, before);
    if (apply) await conn.commit();
    else await conn.rollback();

    const after = apply ? await inspect(conn, false) : before;
    console.log(JSON.stringify({
      ok: true,
      mode: apply ? 'applied' : 'dry-run',
      warehouse: after.warehouse.codigo,
      actor: after.actor.nombre,
      totals: {
        fixtures: after.rows.length,
        target_quantity: after.rows.reduce((sum, item) => sum + item.quantity, 0),
        pending_delta: after.rows.reduce((sum, item) => sum + Math.abs(item.delta), 0),
      },
      rows: after.rows.map(item => ({
        location: item.location,
        sku: item.sku,
        product: item.productName,
        unit: item.unit,
        target: item.quantity,
        current: item.currentStock,
        lot: item.lpn,
      })),
    }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Warehouse map demo seed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { DEMO_STOCK, documentedSkuForLocation, lotCode };
