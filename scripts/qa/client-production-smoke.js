const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
  process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const { resolvePrimaryWarehouse } = require('../../api/_lib/warehouses');
const { releaseProductionOrder, confirmProductionMaterials } = require('../../api/_lib/production-workflow');
const { adjustProductionMaterials } = require('../../api/_lib/production-materials');
const { closeProductionOrder } = require('../../api/_lib/production-close');

const FINAL_SKU = '00102-PTASH60';
const FIXTURE_SKUS = ['00004-TPALB', '00007-TRG', '00017-ETASH60'];
const OUTPUT_LOCATION = 'PPAL-A-1-01';
const USER_ID = 1;

async function ensureFixtureStock(conn) {
  const warehouseId = await resolvePrimaryWarehouse(conn);
  const [locations] = await conn.execute(
    `SELECT id FROM ubicaciones WHERE bodega_id = ? AND codigo = ? AND activa = 1 LIMIT 1`,
    [warehouseId, OUTPUT_LOCATION]
  );
  if (!locations.length) throw new Error(`No existe la ubicacion QA ${OUTPUT_LOCATION}`);
  const locationId = locations[0].id;
  const fixtures = [];
  for (const sku of FIXTURE_SKUS) {
    const [products] = await conn.execute(`SELECT id FROM productos WHERE siigo_code = ? LIMIT 1`, [sku]);
    if (!products.length) throw new Error(`No existe el producto ${sku}`);
    const productId = products[0].id;
    const lpn = `WMSFLOW-QA-${sku}`;
    const [lots] = await conn.execute(`SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`, [lpn]);
    if (!lots.length) {
      await conn.execute(
        `INSERT INTO lots
           (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier,
            origin, status, expiry_date, received_by, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 20, 20, 'WMSFLOW-QA', 'AJUSTE', 'DISPONIBLE',
                 '2027-12-31', ?, 'Fixture controlado para pruebas del flujo cliente', NOW(), NOW())`,
        [crypto.randomUUID(), lpn, productId, warehouseId, USER_ID]
      );
      await conn.execute(
        `INSERT INTO stock
           (producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, '2027-12-31', 20, 0, NOW())`,
        [productId, warehouseId, locationId, lpn]
      );
    }
    fixtures.push({ sku, lpn, locationId });
  }
  return fixtures;
}

async function main() {
  const conn = await createConnection();
  try {
    const fixtures = await ensureFixtureStock(conn);
    const released = await releaseProductionOrder({
      product: FINAL_SKU,
      quantity: 3,
      originType: 'STOCK_SEGURIDAD',
      notes: 'WMSFLOW-QA smoke de produccion con SKU cliente',
      userId: USER_ID,
    });
    const started = await confirmProductionMaterials({ orderId: released.order_code, userId: USER_ID });
    const startRetry = await confirmProductionMaterials({ orderId: released.order_code, userId: USER_ID });
    if (!startRetry.already_confirmed) throw new Error('La segunda confirmacion de materiales no fue idempotente');
    const material = released.picking.find((item) => item.sku === '00051-MPASH');
    if (!material) throw new Error('La reserva no incluyo 00051-MPASH');
    const additional = await adjustProductionMaterials({
      orderId: released.order_code,
      productTerm: material.sku,
      lot: material.lote,
      locationId: material.ubicacion_id,
      type: 'ENTREGA_ADICIONAL',
      quantity: 0.25,
      reason: 'WMSFLOW-QA entrega adicional',
      userId: USER_ID,
    });
    const returned = await adjustProductionMaterials({
      orderId: released.order_code,
      productTerm: material.sku,
      lot: material.lote,
      locationId: material.ubicacion_id,
      type: 'DEVOLUCION',
      quantity: 0.1,
      reason: 'WMSFLOW-QA devolucion a ubicacion de origen',
      userId: USER_ID,
    });
    const closed = await closeProductionOrder({
      orderId: released.order_code,
      qtyReal: 2,
      qtyWaste: 1,
      wasteReason: 'WMSFLOW-QA merma controlada de cierre',
      locationCode: OUTPUT_LOCATION,
      expiryDate: '2027-12-31',
      userId: USER_ID,
    });
    const retry = await closeProductionOrder({ orderId: released.order_code, userId: USER_ID });
    if (!retry.already_closed) throw new Error('El segundo cierre no fue idempotente');
    console.log(JSON.stringify({ fixtures, released, started, startRetry, additional, returned, closed, retry }, null, 2));
  } finally {
    await conn.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${error.code || error.status || 'ERROR'}: ${error.message}`);
    if (error.data) console.error(JSON.stringify(error.data));
    process.exit(1);
  });
