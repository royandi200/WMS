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

async function invoke(handler, req, expectedStatus, label) {
  const res = responseMock();
  await handler(req, res);
  if (res.statusCode !== expectedStatus) {
    throw new Error(`${label}: esperado ${expectedStatus}, recibido ${res.statusCode}: ${res.payload?.error || 'Error'}`);
  }
  return { label, status: res.statusCode, error: res.payload?.error || null };
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const usersHandler = require('../../api/v1/users');
const returnsHandler = require('../../api/v1/returns');
const dispatchHandler = require('../../api/v1/dispatch');
const startHandler = require('../../api/v1/production/start');
const closeHandler = require('../../api/v1/production/close');
const confirmHandler = require('../../api/v1/production/confirm');

async function main() {
  const phone = String(process.env.E2E_ROTATING_PHONE || '').replace(/\D/g, '').slice(-10);
  if (phone.length !== 10) throw new Error('Define E2E_ROTATING_PHONE');
  const conn = await createConnection();
  const [targets] = await conn.execute(
    `SELECT u.id, LOWER(r.nombre) AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) = ? AND u.activo = 1`,
    [phone]
  );
  await conn.end();
  if (targets.length !== 1) throw new Error('La linea rotativa no identifica un unico usuario activo');
  const target = targets[0];
  const actorToken = jwt.sign({ id: 1, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  // Deliberately claim admin in the token: authorization must still use the role currently stored in MySQL.
  const targetToken = jwt.sign({ id: target.id, rol: 'admin' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const actorHeaders = { authorization: `Bearer ${actorToken}` };
  const targetHeaders = { authorization: `Bearer ${targetToken}` };
  const results = [];
  const setRole = async (role) => invoke(usersHandler, {
    method: 'PUT', headers: actorHeaders, body: { user_id: target.id, role },
  }, 200, `rol -> ${role}`);

  try {
    await setRole('recepcion_cierre');
    results.push(await invoke(startHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'recepcion no libera OP'));
    results.push(await invoke(dispatchHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'recepcion no despacha'));
    results.push(await invoke(returnsHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'recepcion no gestiona devolucion'));
    results.push(await invoke(closeHandler, {
      method: 'POST', headers: targetHeaders, body: { order_id: 'OP-WMSFLOW-NO-EXISTE', qty_real: 1, qty_waste: 0, location_id: 1 },
    }, 404, 'recepcion puede intentar cierre'));

    await setRole('alistador');
    results.push(await invoke(startHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'alistador no libera OP'));
    results.push(await invoke(closeHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'alistador no cierra OP'));
    results.push(await invoke(returnsHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'alistador no gestiona devolucion'));
    results.push(await invoke(confirmHandler, {
      method: 'POST', headers: targetHeaders, body: { order_id: 'OP-WMSFLOW-NO-EXISTE' },
    }, 404, 'alistador puede intentar confirmar materiales'));

    await setRole('despacho');
    results.push(await invoke(startHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'despacho no libera OP'));
    results.push(await invoke(closeHandler, { method: 'POST', headers: targetHeaders, body: {} }, 403, 'despacho no cierra OP'));
    results.push(await invoke(returnsHandler, {
      method: 'POST', headers: targetHeaders, body: { sku: '00102-PTASH60', cantidad: 0, cliente_origen: 'WMSFLOW-QA' },
    }, 400, 'despacho puede gestionar devolucion'));
    results.push(await invoke(dispatchHandler, { method: 'POST', headers: targetHeaders, body: {} }, 409, 'despacho directo bloqueado por flag'));
  } finally {
    await setRole(target.rol);
  }
  console.log(JSON.stringify({ ok: true, targetUserId: target.id, restoredRole: target.rol, checks: results }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(`${error.code || 'ERROR'}: ${error.message}`); process.exit(1); });
