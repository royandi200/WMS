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
const { importInvoice } = require('../../api/_lib/siigo.invoice-import');
const { confirmImportedDispatch } = require('../../api/_lib/dispatch-workflow');

async function main() {
  const conn = await createConnection();
  const run = Date.now();
  try {
    const [customers] = await conn.execute(
      `SELECT id, siigo_id, identification, nombre, nombre_comercial
       FROM terceros WHERE siigo_id IS NOT NULL AND identification IS NOT NULL ORDER BY id DESC LIMIT 1`
    );
    if (!customers.length) throw new Error('No hay cliente Siigo sincronizado para el smoke');
    const customer = customers[0];
    const invoiceId = `WMSFLOW-INVOICE-${run}`;
    const invoiceName = `FV-WMSFLOW-${run}`;
    const imported = await importInvoice({
      id: invoiceId,
      name: invoiceName,
      date: new Date().toISOString().slice(0, 10),
      customer: {
        id: customer.siigo_id,
        identification: customer.identification,
        name: customer.nombre_comercial || customer.nombre,
      },
      observations: 'WMSFLOW-QA factura sintetica para validar despacho',
      total: 1,
      items: [{ code: '00102-PTASH60', quantity: 1, price: 1, discount: 0 }],
    }, 1);
    if (!imported.ready_to_dispatch || imported.shortages.length) {
      throw new Error('La factura QA no quedo completamente reservada');
    }
    const allocatedLot = imported.reserved[0]?.lote;
    const [beforeRows] = await conn.execute(
      `SELECT s.cantidad, s.reservada, l.qty_current
       FROM stock s JOIN lots l ON l.lpn = s.lote
       WHERE s.producto_id = (SELECT id FROM productos WHERE siigo_code = '00102-PTASH60')
         AND s.lote = ? LIMIT 1`,
      [allocatedLot]
    );
    const confirmed = await confirmImportedDispatch({ dispatchId: imported.id, userId: 1 });
    const retry = await confirmImportedDispatch({ dispatchId: imported.id, userId: 1 });
    const [afterRows] = await conn.execute(
      `SELECT s.cantidad, s.reservada, l.qty_current
       FROM stock s JOIN lots l ON l.lpn = s.lote
       WHERE s.producto_id = (SELECT id FROM productos WHERE siigo_code = '00102-PTASH60')
         AND s.lote = ? LIMIT 1`,
      [allocatedLot]
    );
    const before = beforeRows[0];
    const after = afterRows[0];
    if (Number(before.cantidad) - Number(after.cantidad) !== 1
        || Number(before.reservada) - Number(after.reservada) !== 1
        || Number(before.qty_current) - Number(after.qty_current) !== 1) {
      throw new Error('El despacho no desconto exactamente una unidad reservada');
    }
    if (!retry.already_completed) throw new Error('El despacho repetido no fue idempotente');
    console.log(JSON.stringify({ imported, allocatedLot, before, confirmed, retry, after }, null, 2));
  } finally {
    await conn.end().catch(() => {});
  }
}

main().catch((error) => { console.error(`${error.code || error.status || 'ERROR'}: ${error.message}`); process.exitCode = 1; });
