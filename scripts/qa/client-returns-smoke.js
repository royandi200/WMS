const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

async function invoke(handler, req, expectedStatus = 200) {
  const res = responseMock();
  await handler(req, res);
  if (res.statusCode !== expectedStatus) {
    throw new Error(`Esperado ${expectedStatus}, recibido ${res.statusCode}: ${res.payload?.error || 'Error de handler'}`);
  }
  return res.payload;
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const returnsHandler = require('../../api/v1/returns');

async function main() {
  const run = Date.now();
  const token = jwt.sign({ id: 1, email: 'admin@wms.co', rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const headers = { authorization: `Bearer ${token}` };
  const statuses = ['RECUPERABLE', 'CUARENTENA', 'DESTRUCCION'];
  const created = [];
  for (const status of statuses) {
    const lpn = `WMSFLOW-DEV-${status}-${run}`;
    const result = await invoke(returnsHandler, {
      method: 'POST', headers, body: {
        sku: '00102-PTASH60',
        cantidad: 1,
        cliente_origen: `WMSFLOW-QA-${run}`,
        estado: status,
        lot_id: lpn,
        lote_origen: 'TEST_AGENT-PTASH-DISP',
        observaciones: `WMSFLOW-QA devolucion ${status}`,
      },
    });
    created.push(result.data);
  }
  await invoke(returnsHandler, {
    method: 'POST', headers, body: {
      sku: '00102-PTASH60', cantidad: 0, cliente_origen: `WMSFLOW-QA-${run}`, estado: 'RECUPERABLE',
    },
  }, 400);

  const conn = await createConnection();
  try {
    const lpns = created.map((item) => item.lote);
    const [lots] = await conn.execute(
      `SELECT lpn, status, qty_current FROM lots WHERE lpn IN (?, ?, ?) ORDER BY lpn`, lpns
    );
    const [stock] = await conn.execute(
      `SELECT lote, cantidad FROM stock WHERE lote IN (?, ?, ?) ORDER BY lote`, lpns
    );
    const [returns] = await conn.execute(
      `SELECT lote, estado, cantidad FROM devoluciones WHERE lote IN (?, ?, ?) ORDER BY lote`, lpns
    );
    if (lots.length !== 3 || returns.length !== 3) throw new Error('No se registraron las tres devoluciones');
    const lotStatus = new Map(lots.map((lot) => [lot.lpn, lot.status]));
    if (lotStatus.get(lpns[0]) !== 'DISPONIBLE'
        || lotStatus.get(lpns[1]) !== 'CUARENTENA'
        || lotStatus.get(lpns[2]) !== 'PENDIENTE_DISPOSICION') {
      throw new Error('Los estados fisicos de los lotes devueltos no son validos');
    }
    if (stock.length !== 1 || !stock[0].lote.includes('RECUPERABLE') || Number(stock[0].cantidad) !== 1) {
      throw new Error('Cuarentena o destruccion ingresaron al stock disponible');
    }
    console.log(JSON.stringify({ run, created, lots, stock, returns, invalidQuantityRejected: true }, null, 2));
  } finally {
    await conn.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(`${error.code || 'ERROR'}: ${error.message}`); process.exit(1); });
