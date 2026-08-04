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
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), ...options });
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType) || /^\s*<!doctype html/i.test(text)) {
    throw new Error(`${response.status} HTML recibido en ${new URL(url).pathname}`);
  }
  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new Error(`${response.status} JSON invalido en ${new URL(url).pathname}`); }
  if (!response.ok || data?.ok === false) {
    throw new Error(`${response.status} ${data?.error || data?.message || 'Error API'} en ${new URL(url).pathname}`);
  }
  return { status: response.status, data };
}

function countRows(data) {
  const candidates = [data?.data?.rows, data?.data?.items, data?.data, data?.rows, data?.items];
  const rows = candidates.find(Array.isArray);
  return rows ? rows.length : null;
}

async function main() {
  loadEnv();
  const base = String(process.env.WMS_PUBLIC_URL || 'https://wms-seven-ebon.vercel.app').replace(/\/$/, '');
  const email = process.env.E2E_DASHBOARD_EMAIL;
  const password = process.env.E2E_DASHBOARD_PASSWORD;
  if (!email || !password) throw new Error('Define E2E_DASHBOARD_EMAIL y E2E_DASHBOARD_PASSWORD');

  const login = await requestJson(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const token = login.data?.access_token || login.data?.data?.access_token
    || login.data?.data?.token || login.data?.token;
  if (!token) throw new Error('Login exitoso sin token');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const routes = [
    '/auth/me',
    '/inventory/summary',
    '/inventory/low-stock',
    '/inventory/product/00102-PTASH60',
    '/inventory/lot/TEST_AGENT-PTASH-DISP',
    '/inventory/kardex?limit=20',
    '/inventory/mapa',
    '/inventory/ubicaciones',
    '/products?limit=20',
    '/products?tipo=MP&limit=20',
    '/production?limit=20',
    '/reception?limit=20',
    '/purchase-orders?limit=20',
    '/dispatch?limit=20',
    '/returns?limit=20',
    '/waste?limit=20',
    '/approvals?limit=20',
    '/webhook/logs?limit=20',
    '/users?limit=100',
    '/notifications?limit=20',
  ];
  const results = [];
  for (const route of routes) {
    try {
      const result = await requestJson(`${base}/api/v1${route}`, { headers });
      results.push({ route, ok: true, status: result.status, rows: countRows(result.data) });
    } catch (error) {
      results.push({ route, ok: false, error: error.message });
    }
  }
  const failures = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ ok: failures.length === 0, base, routes: results.length, results }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Dashboard API smoke: ${error.message}`);
  process.exitCode = 1;
});
