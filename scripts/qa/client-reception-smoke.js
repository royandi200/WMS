const fs = require('fs');
const jwt = require('jsonwebtoken');
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
  process.env.JWT_SECRET ||= 'wmsflow-qa-local-only-secret';
}

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

async function invoke(handler, req) {
  const res = responseMock();
  await handler(req, res);
  if (res.statusCode >= 400 || res.payload?.ok === false) {
    throw new Error(`${res.statusCode}: ${res.payload?.error || 'Error de handler'}`);
  }
  return res.payload;
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const purchaseOrdersHandler = require('../../api/v1/purchase-orders');
const receptionHandler = require('../../api/v1/reception');
const { importPurchase } = require('../../api/_lib/siigo.purchase-import');

async function main() {
  const conn = await createConnection();
  const run = Date.now();
  const token = jwt.sign({ id: 1, email: 'admin@wms.co', rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const headers = { authorization: `Bearer ${token}` };
  try {
    const [suppliers] = await conn.execute(
      `SELECT id, siigo_id, identification, nombre FROM terceros
       WHERE siigo_id IS NOT NULL AND identification IS NOT NULL
       ORDER BY id LIMIT 1`
    );
    if (!suppliers.length) throw new Error('No hay proveedor Siigo sincronizado para el smoke');
    const supplier = suppliers[0];
    const [locations] = await conn.execute(
      `SELECT u.id, u.codigo FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
       WHERE b.codigo = 'BG-PPAL' AND u.codigo IN ('PPAL-A-1-01','PPAL-A-1-02') AND u.activa = 1`
    );
    const locationByCode = new Map(locations.map((row) => [row.codigo, row.id]));
    if (locationByCode.size !== 2) throw new Error('Faltan ubicaciones QA de recepcion');

    const orderNumber = `OC-WMSFLOW-${run}`;
    const order = await invoke(purchaseOrdersHandler, {
      method: 'POST', headers, body: {
        numero: orderNumber,
        tercero_id: supplier.id,
        proveedor_nombre: supplier.nombre,
        fecha_orden: new Date().toISOString().slice(0, 10),
        archivo_nombre: `${orderNumber}.json`,
        datos_origen: { test: true, marker: 'WMSFLOW-QA' },
        items: [{ sku: '00004-TPALB', cantidad_ordenada: 5, unidad: 'und', precio_unitario: 1 }],
      },
    });

    const imported = await importPurchase({
      id: `WMSFLOW-PURCHASE-${run}`,
      name: `FC-WMSFLOW-${run}`,
      date: new Date().toISOString().slice(0, 10),
      supplier: { id: supplier.siigo_id, identification: supplier.identification, name: supplier.nombre },
      provider_invoice: { prefix: 'QA', number: String(run).slice(-8) },
      total: 5,
      observations: 'WMSFLOW-QA factura sintetica para validar recepcion',
      items: [{ code: '00004-TPALB', quantity: 5, price: 1, discount: 0 }],
    }, 1);

    const availableLot = `WMSFLOW-REC-OK-${run}`;
    const quarantineLot = `WMSFLOW-REC-Q-${run}`;
    const rejectedLot = `WMSFLOW-REC-R-${run}`;
    const confirmation = await invoke(receptionHandler, {
      method: 'PUT', headers, body: {
        reception_id: imported.id,
        orden_compra_id: order.data.id,
        qty_received: 5,
        notes: 'WMSFLOW-QA conciliacion fisica controlada',
        distributions: [
          { condicion: 'DISPONIBLE', cantidad: 3, lote: availableLot, ubicacion_id: locationByCode.get('PPAL-A-1-01'), fecha_venc: '2027-12-31' },
          { condicion: 'CUARENTENA', cantidad: 1, lote: quarantineLot, ubicacion_id: locationByCode.get('PPAL-A-1-02'), fecha_venc: '2027-12-31', motivo: 'Revision QA' },
          { condicion: 'RECHAZADO', cantidad: 1, lote: rejectedLot, motivo: 'Empaque no conforme QA' },
        ],
      },
    });
    const retry = await invoke(receptionHandler, {
      method: 'PUT', headers, body: { reception_id: imported.id, orden_compra_id: order.data.id },
    });

    const [stock] = await conn.execute(`SELECT lote, cantidad FROM stock WHERE lote IN (?, ?, ?) ORDER BY lote`, [availableLot, quarantineLot, rejectedLot]);
    const [lots] = await conn.execute(`SELECT lpn, status, qty_current FROM lots WHERE lpn IN (?, ?, ?) ORDER BY lpn`, [availableLot, quarantineLot, rejectedLot]);
    if (stock.length !== 1 || stock[0].lote !== availableLot || Number(stock[0].cantidad) !== 3) {
      throw new Error('Cuarentena o rechazo ingresaron al stock disponible');
    }
    if (!retry.data?.already_completed) throw new Error('La confirmacion repetida no fue idempotente');
    console.log(JSON.stringify({ order: order.data, imported, confirmation: confirmation.data, retry: retry.data, stock, lots }, null, 2));
  } finally {
    await conn.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${error.code || 'ERROR'}: ${error.message}`);
    process.exit(1);
  });
