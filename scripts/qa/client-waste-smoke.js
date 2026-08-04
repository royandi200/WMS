const fs = require('fs');
const jwt = require('jsonwebtoken');
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
  process.env.JWT_SECRET ||= 'wmsflow-qa-local-only-secret';
}

function responseMock() {
  return {
    statusCode: 200, payload: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

async function invoke(handler, req, expectedStatus) {
  const res = responseMock();
  await handler(req, res);
  if (res.statusCode !== expectedStatus) {
    throw new Error(`Esperado ${expectedStatus}, recibido ${res.statusCode}: ${res.payload?.error || 'Error de handler'}`);
  }
  return res.payload;
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const wasteHandler = require('../../api/v1/waste');

async function main() {
  const conn = await createConnection();
  const token = jwt.sign({ id: 1, email: 'admin@wms.co', rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const headers = { authorization: `Bearer ${token}` };
  try {
    const [candidates] = await conn.execute(
      `SELECT s.lote, s.cantidad, l.qty_current
       FROM stock s JOIN lots l ON l.lpn = s.lote JOIN productos p ON p.id = s.producto_id
       WHERE p.siigo_code = '00102-PTASH60' AND s.lote LIKE 'WMSFLOW-DEV-RECUPERABLE-%'
         AND s.cantidad >= 1 ORDER BY s.actualizado_en DESC LIMIT 1`
    );
    if (!candidates.length) throw new Error('No hay lote recuperable QA para probar merma');
    const before = candidates[0];
    const result = await invoke(wasteHandler, {
      method: 'POST', headers, body: {
        sku: '00102-PTASH60', cantidad: 0.25, lot_id: before.lote,
        motivo: 'WMSFLOW-QA merma controlada de lote recuperable',
      },
    }, 200);
    await invoke(wasteHandler, {
      method: 'POST', headers, body: {
        sku: '00102-PTASH60', cantidad: 99, lot_id: before.lote,
        motivo: 'WMSFLOW-QA intento sin stock',
      },
    }, 409);
    const [afterRows] = await conn.execute(
      `SELECT s.cantidad, l.qty_current FROM stock s JOIN lots l ON l.lpn = s.lote
       WHERE s.lote = ? LIMIT 1`, [before.lote]
    );
    const [wasteRows] = await conn.execute(
      `SELECT numero, cantidad, motivo FROM mermas WHERE numero = ? LIMIT 1`, [result.data.numero]
    );
    const after = afterRows[0];
    if (Number(before.cantidad) - Number(after.cantidad) !== 0.25
        || Number(before.qty_current) - Number(after.qty_current) !== 0.25
        || wasteRows.length !== 1) {
      throw new Error('La merma no concilia entre stock, lote y registro');
    }
    console.log(JSON.stringify({ result: result.data, before, after, excessiveWasteRejected: true }, null, 2));
  } finally {
    await conn.end().catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(`${error.code || 'ERROR'}: ${error.message}`); process.exit(1); });
