const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) return;
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

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `57${digits}`;
  return /^573\d{9}$/.test(digits) ? digits : null;
}

async function post(url, payload) {
  if (process.env.E2E_WEBHOOK_LOCAL === 'true') {
    const handler = require('../../api/v1/webhook/builderbot');
    const response = {
      statusCode: 200, payload: null, setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(data) { this.payload = data; return this; },
      end() { return this; },
    };
    await handler({ method: 'POST', headers: {}, body: payload }, response);
    return { status: response.statusCode, data: response.payload };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${response.status} respuesta no JSON`); }
  return { status: response.status, data };
}

function assertCleanMessage(result, label) {
  if (result.status !== 200 || result.data?.ok === false) {
    throw new Error(`${label}: ${result.status} ${result.data?.error || 'Error webhook'}`);
  }
  const message = result.data?.mensaje || result.data?.message;
  if (!message || typeof message !== 'string') throw new Error(`${label}: respuesta sin mensaje`);
  if (result.data?.mensaje !== result.data?.message) throw new Error(`${label}: mensaje y message no coinciden`);
  if (/\{mensaje\}|undefined|^\s*\{[\s\S]*\}\s*$/i.test(message)) {
    throw new Error(`${label}: mensaje contiene placeholder, undefined o JSON crudo`);
  }
  return { label, status: result.status, chars: message.length, firstLine: message.split('\n')[0] };
}

async function main() {
  loadEnv();
  const phone = normalizePhone(process.env.E2E_ADMIN_PHONE);
  if (!phone) throw new Error('Define E2E_ADMIN_PHONE');
  const base = String(process.env.WMS_PUBLIC_URL || 'https://wms-seven-ebon.vercel.app').replace(/\/$/, '');
  const url = `${base}/api/v1/webhook/builderbot`;
  const cases = [
    {
      label: 'saludo',
      action: 'MODO_CHARLA',
      text: 'hola, como esta el inventario hoy',
      params: { texto: 'Hola. Puedo ayudarte a consultar inventario y operaciones de bodega.' },
    },
    {
      label: 'stock producto terminado',
      action: 'CONSULTAR_STOCK_PRODUCTO_TERMINADO',
      text: 'cuanto stock hay de 00102-PTASH60',
      params: { id_item: '00102-PTASH60' },
    },
    {
      label: 'trazabilidad lote',
      action: 'CONSULTAR_TRAZABILIDAD_LOTE',
      text: 'dame la trazabilidad de TEST_AGENT-PTASH-DISP',
      params: { id_lote: 'TEST_AGENT-PTASH-DISP' },
    },
    {
      label: 'capacidad fabricacion',
      action: 'CONSULTAR_CAPACIDAD_FABRICACION',
      text: 'cuanto podemos fabricar de 00102-PTASH60',
      params: { id_item: '00102-PTASH60' },
    },
  ];
  const results = [];
  for (const testCase of cases) {
    const info = {
      kw: 'g0m@s',
      '@ction': testCase.action,
      priority: 'baja',
      body: testCase.text,
      text: testCase.text,
      query: testCase.text,
      params: testCase.params,
    };
    const result = await post(url, { from: phone, info: JSON.stringify(info) });
    results.push(assertCleanMessage(result, testCase.label));
  }

  const unauthorized = await post(url, {
    from: phone,
    info: JSON.stringify({ kw: 'incorrecta', '@ction': 'CONSULTAR_STOCK_PRODUCTO_TERMINADO', params: { id_item: '00102-PTASH60' } }),
  });
  if (unauthorized.status !== 200 || unauthorized.data?.ok !== false
      || !/(no autorizado|auth no configurada)/i.test(unauthorized.data?.mensaje || unauthorized.data?.message || '')) {
    throw new Error(`webhook sin credencial no fue rechazado por el contrato BuilderBot`);
  }
  results.push({ label: 'webhook sin credencial', status: unauthorized.status, rejected: true });
  console.log(JSON.stringify({ ok: true, endpoint: url, checks: results }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(`BuilderBot webhook smoke: ${error.message}`); process.exit(1); });
