const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] ||= value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

async function main() {
  loadEnv();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 15000,
  });
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  const rows = async (sql, params = []) => (await conn.execute(sql, params))[0];

  try {
    const [invariants] = await rows(
      `SELECT SUM(cantidad < 0) AS stock_negativo,
              SUM(reservada < 0) AS reserva_negativa,
              SUM(reservada > cantidad) AS reserva_superior_stock
       FROM stock`
    );
    add('global-stock-invariants', Number(invariants.stock_negativo) === 0
      && Number(invariants.reserva_negativa) === 0
      && Number(invariants.reserva_superior_stock) === 0, invariants);

    const duplicatePurchases = await rows(
      `SELECT siigo_purchase_id, COUNT(*) AS total FROM recepciones
       WHERE siigo_purchase_id LIKE 'WMSFLOW-PURCHASE-%'
       GROUP BY siigo_purchase_id HAVING COUNT(*) > 1`
    );
    add('purchase-idempotency', duplicatePurchases.length === 0, { duplicates: duplicatePurchases.length });

    const duplicateInvoices = await rows(
      `SELECT siigo_invoice_id, COUNT(*) AS total FROM despachos
       WHERE siigo_invoice_id LIKE 'WMSFLOW-INVOICE-%'
       GROUP BY siigo_invoice_id HAVING COUNT(*) > 1`
    );
    add('invoice-idempotency', duplicateInvoices.length === 0, { duplicates: duplicateInvoices.length });

    const receptions = await rows(
      `SELECT r.id, r.numero, r.estado, r.siigo_purchase_id,
              SUM(ri.cantidad_rec) AS recibido
       FROM recepciones r JOIN recepcion_items ri ON ri.recepcion_id = r.id
       WHERE r.siigo_purchase_id LIKE 'WMSFLOW-PURCHASE-%'
       GROUP BY r.id ORDER BY r.id DESC LIMIT 5`
    );
    add('qa-receptions-completed', receptions.length > 0
      && receptions.every((row) => row.estado === 'completada' && Number(row.recibido) === 5), receptions);

    const blockedStock = await rows(
      `SELECT s.lote, s.cantidad FROM stock s
       WHERE s.lote LIKE 'WMSFLOW-REC-Q-%' OR s.lote LIKE 'WMSFLOW-REC-R-%'`
    );
    add('blocked-reception-not-available', blockedStock.length === 0, blockedStock);

    const invalidReturnLots = await rows(
      `SELECT l.lpn, l.status, d.estado
       FROM lots l JOIN devoluciones d ON d.lote = l.lpn
       WHERE l.origin = 'DEVOLUCION'
         AND l.status <> CASE UPPER(d.estado)
           WHEN 'RECUPERABLE' THEN 'DISPONIBLE'
           WHEN 'CUARENTENA' THEN 'CUARENTENA'
           ELSE 'PENDIENTE_DISPOSICION'
         END`
    );
    add('return-lot-statuses', invalidReturnLots.length === 0, invalidReturnLots);

    const productionReference = String(process.env.QA_PRODUCTION_ORDER || '').trim();
    const productions = await rows(
      `SELECT op.id, op.codigo_orden, op.estado, op.fase, op.cantidad_planeada,
              op.cantidad_real,
              (SELECT l.lpn FROM lots l WHERE l.production_order_id = op.id ORDER BY l.created_at LIMIT 1) AS lpn_terminado,
              (SELECT COUNT(*) FROM lots l WHERE l.production_order_id = op.id) AS lotes_terminados,
              (SELECT COALESCE(SUM(l.qty_initial), 0) FROM lots l WHERE l.production_order_id = op.id) AS cantidad_inicial_pt,
              (SELECT COALESCE(SUM(l.qty_current), 0) FROM lots l WHERE l.production_order_id = op.id) AS cantidad_actual_pt,
              (SELECT COALESCE(SUM(m.cantidad), 0) FROM mermas m
               WHERE m.orden_produccion_id = op.id AND m.producto_id = op.producto_id
                 AND m.referencia_externa IS NULL) AS merma_cierre,
              (SELECT COUNT(*) FROM mermas m
               WHERE m.orden_produccion_id = op.id AND m.producto_id = op.producto_id
                 AND m.referencia_externa IS NULL) AS mermas_cierre,
              (SELECT COALESCE(SUM(m.cantidad), 0) FROM mermas m
               WHERE m.orden_produccion_id = op.id
                 AND (m.producto_id <> op.producto_id OR m.referencia_externa IS NOT NULL)) AS merma_proceso,
              (SELECT COUNT(*) FROM mermas m
               WHERE m.orden_produccion_id = op.id
                 AND (m.producto_id <> op.producto_id OR m.referencia_externa IS NOT NULL)) AS eventos_merma_proceso
       FROM ordenes_produccion op
       WHERE op.estado = 'CERRADA'
         AND (? = '' OR op.codigo_orden = ? OR op.id = ?)
       ORDER BY op.id DESC LIMIT 1`,
      [productionReference, productionReference, Number(productionReference) || 0]
    );
    const latestProduction = productions[0];
    const plannedQuantity = Number(latestProduction?.cantidad_planeada);
    const actualQuantity = Number(latestProduction?.cantidad_real);
    const expectedOutputLots = actualQuantity > 0 ? 1 : 0;
    add('qa-production-closed', Boolean(latestProduction)
      && latestProduction.estado === 'CERRADA'
      && latestProduction.fase === 'F5'
      && Number.isFinite(plannedQuantity) && plannedQuantity > 0
      && Number.isFinite(actualQuantity) && actualQuantity >= 0 && actualQuantity <= plannedQuantity
      && Number(latestProduction.lotes_terminados) === expectedOutputLots
      && Math.abs(Number(latestProduction.cantidad_inicial_pt) - actualQuantity) < 0.0001
      && Number(latestProduction.mermas_cierre) <= 1,
    {
      selection: productionReference ? `QA_PRODUCTION_ORDER=${productionReference}` : 'ultima OP cerrada',
      order: latestProduction || null,
    });

    const productionLots = latestProduction ? await rows(
      `SELECT l.lpn, l.qty_initial, l.qty_current, l.status,
              COALESCE(SUM(s.cantidad), 0) AS stock_total,
              COALESCE(SUM(s.reservada), 0) AS reservado_total
       FROM lots l LEFT JOIN stock s ON s.lote = l.lpn AND s.producto_id = l.product_id
       WHERE l.production_order_id = ?
       GROUP BY l.id, l.lpn, l.qty_initial, l.qty_current, l.status`,
      [latestProduction.id]
    ) : [];
    add('qa-production-output-stock', productionLots.length === expectedOutputLots
      && productionLots.every((lot) => Number(lot.qty_initial) >= Number(lot.qty_current)
        && Number(lot.qty_current) >= 0
        && Math.abs(Number(lot.qty_current) - Number(lot.stock_total)) < 0.0001
        && Number(lot.reservado_total) >= 0
        && Number(lot.reservado_total) <= Number(lot.stock_total)), productionLots);

    const dispatches = await rows(
      `SELECT d.id, d.numero, d.estado, d.siigo_invoice_id,
              SUM(di.cantidad_sol) AS solicitado, SUM(di.cantidad_des) AS despachado
       FROM despachos d JOIN despacho_items di ON di.despacho_id = d.id
       WHERE d.siigo_invoice_id LIKE 'WMSFLOW-INVOICE-%'
       GROUP BY d.id ORDER BY d.id DESC LIMIT 5`
    );
    add('qa-dispatch-completed', dispatches.length > 0
      && dispatches[0].estado === 'despachado'
      && Number(dispatches[0].solicitado) === 1
      && Number(dispatches[0].despachado) === 1, dispatches[0] || null);

    const availableLotMismatch = await rows(
      `SELECT l.lpn, l.qty_current, COALESCE(SUM(s.cantidad), 0) AS stock_total
       FROM lots l LEFT JOIN stock s ON s.lote = l.lpn
       WHERE l.status = 'DISPONIBLE'
         AND (l.lpn LIKE 'WMSFLOW-%' OR l.lpn LIKE 'LPN-OP-%')
       GROUP BY l.id, l.lpn, l.qty_current
       HAVING ABS(l.qty_current - COALESCE(SUM(s.cantidad), 0)) > 0.0001`
    );
    add('qa-lot-stock-reconciliation', availableLotMismatch.length === 0,
      { mismatches: availableLotMismatch });

    const failures = checks.filter((check) => !check.ok);
    console.log(JSON.stringify({ ok: failures.length === 0, checks, failures: failures.map((check) => check.id) }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(`E2E database audit: ${error.message}`);
  process.exitCode = 1;
});
