const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-creates-a-demo-dispatch';
const SCENARIOS = Object.freeze({
  own: {
    invoiceId: 'DEMO-INVOICE-PR-20260902-001',
    invoiceName: 'FV-DEMO-PR-001',
    sku: '00102-PTASH60',
    quantity: 1,
  },
  io: {
    invoiceId: 'DEMO-INVOICE-IO-20260902-001',
    invoiceName: 'FV-DEMO-IO-001',
    sku: '00276-PTZNASHWA',
    quantity: 2,
  },
  outsourcing: {
    invoiceId: 'DEMO-INVOICE-3Q-20260902-001',
    invoiceName: 'FV-DEMO-3Q-001',
    sku: '00105-PTBOS60',
    quantity: 2,
  },
});

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
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

function connectionConfig() {
  loadEnvFile();
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 15000,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

function argument(name) {
  return String(process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '').trim();
}

async function inspect(conn, scenario) {
  const [users] = await conn.execute(
    `SELECT u.id, u.nombre, u.telefono, LOWER(r.nombre) AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) = '3174442659'
        AND u.activo = 1 LIMIT 1`
  );
  if (!users.length || users[0].rol !== 'admin') throw new Error('No existe el administrador de demo');
  const [customers] = await conn.execute(
    `SELECT id, siigo_id, identification, nombre, nombre_comercial
       FROM terceros
      WHERE tipo = 'Customer' AND activo = 1 AND siigo_id IS NOT NULL
        AND nombre LIKE 'WMSQA260721%'
      ORDER BY id LIMIT 1`
  );
  if (!customers.length) throw new Error('No existe el cliente sintetico del demo');
  const [products] = await conn.execute(
    `SELECT id, siigo_code, nombre, modalidad_operativa
       FROM productos WHERE siigo_code = ? AND activo = 1 LIMIT 1`,
    [scenario.sku]
  );
  if (!products.length) throw new Error(`No existe el producto ${scenario.sku}`);
  const [stockRows] = await conn.execute(
    `SELECT COALESCE(SUM(CASE
              WHEN l.status = 'DISPONIBLE'
               AND (l.expiry_date IS NULL OR l.expiry_date >= CURDATE())
               AND u.activa = 1
              THEN s.cantidad - COALESCE(s.reservada, 0) ELSE 0 END), 0) AS disponible
       FROM stock s
       LEFT JOIN lots l ON l.product_id = s.producto_id AND l.lpn = s.lote
       LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
      WHERE s.producto_id = ?`,
    [products[0].id]
  );
  const [dispatches] = await conn.execute(
    `SELECT id, numero, estado, siigo_invoice_id, siigo_invoice_name
       FROM despachos WHERE siigo_invoice_id = ? LIMIT 1`,
    [scenario.invoiceId]
  );
  return {
    admin: users[0],
    customer: customers[0],
    product: products[0],
    available: Number(stockRows[0]?.disponible || 0),
    existingDispatch: dispatches[0] || null,
  };
}

async function main() {
  const scenarioName = argument('scenario').toLowerCase();
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) throw new Error(`Usa --scenario=${Object.keys(SCENARIOS).join('|')}`);
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  loadEnvFile();
  if (!process.argv.includes('--notify')) process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn, scenario);
    if (!before.existingDispatch && before.available + 0.0001 < scenario.quantity) {
      throw new Error(`Stock insuficiente para ${scenario.sku}: requiere ${scenario.quantity}, disponible ${before.available}`);
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', scenario: scenarioName, fixture: scenario, before }, null, 2));
      return;
    }
    const { importInvoice } = require('../../api/_lib/siigo.invoice-import');
    const result = await importInvoice({
      id: scenario.invoiceId,
      name: scenario.invoiceName,
      date: '2026-09-02',
      customer: {
        id: before.customer.siigo_id,
        identification: before.customer.identification,
        name: before.customer.nombre_comercial || before.customer.nombre,
      },
      total: scenario.quantity,
      observations: `Factura sintetica del demo ${scenarioName}; no proviene de Siigo`,
      items: [{ code: scenario.sku, quantity: scenario.quantity, price: 1, discount: 0 }],
    }, before.admin.id);
    const after = await inspect(conn, scenario);
    if (!after.existingDispatch || !['picking', 'borrador'].includes(after.existingDispatch.estado)) {
      throw new Error('La factura demo no dejo una tarea de despacho pendiente');
    }
    console.log(JSON.stringify({
      ok: true,
      mode: 'applied',
      scenario: scenarioName,
      notifications_enabled: process.argv.includes('--notify'),
      result,
      dispatch: after.existingDispatch,
    }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
