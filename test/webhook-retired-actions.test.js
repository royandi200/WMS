const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Webhook completo contra una base simulada: permite verificar el contrato
// que ve BuilderBot sin tocar la base real ni enviar mensajes.
const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
const executed = [];
const ADMIN = { id: 5, nombre: 'Admin QA', telefono: '573150000059', activo: 1, rol_nombre: 'admin', email: 'qa@wms.co' };

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    createConnection: async () => ({
      async execute(sql, params = []) {
        executed.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        if (/FROM usuarios u\s+LEFT JOIN roles r/.test(sql)) return [params[0] === ADMIN.telefono ? [ADMIN] : []];
        if (/FROM bodegas WHERE activa = 1/.test(sql)) return [[{ id: 1 }]];
        if (/^\s*INSERT/i.test(sql)) return [{ insertId: 1 }];
        return [[]];
      },
      async query(sql, params) { return this.execute(sql, params); },
      async beginTransaction() {}, async commit() {}, async rollback() {}, async end() {},
    }),
    query: async () => [],
    withTransaction: async (fn) => fn(await require.cache[dbPath].exports.createConnection()),
  },
};

process.env.BUILDERBOT_WEBHOOK_SECRET = 'qa-webhook-secret';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
delete process.env.ENABLE_APPROVALS_WORKFLOW;

const handler = require('../api/v1/webhook/builderbot');

async function call({ action, text, params = {}, headers = { 'x-builderbot-secret': 'qa-webhook-secret' }, kw, from = ADMIN.telefono }) {
  executed.length = 0;
  const info = { '@ction': action, body: text, text, query: text, params };
  if (kw) info.kw = kw;
  const req = { method: 'POST', headers, body: { from, info } };
  const res = {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return res;
}

const mutations = () => executed
  .filter(e => /^(INSERT|UPDATE|DELETE)/i.test(e.sql))
  .filter(e => !/INTO webhook_logs|UPDATE webhook_logs/i.test(e.sql));

const RETIRED = [
  ['SOLICITAR_INICIO_PRODUCCION', 'quiero iniciar la produccion de 10 unidades', /se libera directamente/i],
  ['SOLICITAR_CIERRE_PRODUCCION', 'solicito cerrar la orden', /se cierra directamente/i],
  ['CONSULTAR_SOLICITUDES_PENDIENTES', 'que solicitudes hay pendientes', /aprobaciones fue retirado/i],
  ['APROBAR_SOLICITUD', 'apruebo REQ-000001', /aprobaciones fue retirado/i],
  ['RECHAZAR_SOLICITUD', 'rechazo REQ-000001', /aprobaciones fue retirado/i],
  ['SOLICITAR_DESPACHO', 'despacha 5 unidades al cliente', /factura de venta de Siigo/i],
  ['INGRESO_RECEPCION', 'ingresa 5 unidades', /OC operativa o una orden de maquila/i],
];

for (const [action, text, guidance] of RETIRED) {
  test(`DEP ${action}: guia vigente, registro RETIRED_FLOW y ninguna escritura`, async () => {
    const res = await call({ action, text });
    assert.equal(res.statusCode, 200, 'BuilderBot necesita 200 para mostrar el mensaje');
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'RETIRED_FLOW');
    assert.match(res.body.mensaje, guidance);
    assert.deepEqual(mutations(), [], `no debe escribir fuera de webhook_logs: ${JSON.stringify(mutations())}`);
    assert.ok(executed.some(e => /INSERT INTO webhook_logs/.test(e.sql) && e.params.includes('REJECTED')),
      'debe quedar registrado como rechazado');
  });
}

test('DEP-04 "apruebo" en lenguaje natural tambien queda bloqueado', async () => {
  const res = await call({ action: 'MODO_CHARLA', text: 'apruebo REQ-000123' });
  assert.equal(res.body.error, 'RETIRED_FLOW');
  assert.deepEqual(mutations(), []);
});

test('una accion vigente de consulta no se bloquea', async () => {
  const res = await call({ action: 'CONSULTAR_RECEPCIONES_PENDIENTES', text: 'que recepciones hay pendientes' });
  assert.notEqual(res.body?.error, 'RETIRED_FLOW');
});

test('un numero no registrado se rechaza antes de cualquier operacion', async () => {
  const res = await call({ action: 'CONSULTAR_STOCK_MATERIA_PRIMA', text: 'stock', from: '573009999999' });
  assert.equal(res.body.error, 'UNREGISTERED_PHONE');
  assert.deepEqual(mutations(), []);
});

test('sin secreto ni palabra clave la llamada no se autoriza', async () => {
  const res = await call({ action: 'CONSULTAR_STOCK_MATERIA_PRIMA', text: 'stock', headers: {} });
  assert.equal(res.body.ok, false);
  assert.match(res.body.mensaje, /no autorizado/i);
  assert.equal(executed.length, 0);
});

test('con un secreto incorrecto la llamada no se autoriza', async () => {
  const res = await call({ action: 'CONSULTAR_STOCK_MATERIA_PRIMA', text: 'stock', headers: { 'x-builderbot-secret': 'otro' } });
  assert.match(res.body.mensaje, /no autorizado/i);
  assert.equal(executed.length, 0);
});

// S-01: documenta el comportamiento vigente. Cuando se retire el respaldo por
// palabra clave, esta prueba debe invertirse para exigir el rechazo.
test('S-01 la palabra clave publica autentica sin el secreto (riesgo abierto)', async () => {
  const res = await call({ action: 'CONSULTAR_STOCK_MATERIA_PRIMA', text: 'stock', headers: {}, kw: 'g0m@s' });
  assert.doesNotMatch(String(res.body?.mensaje || ''), /no autorizado/i);
  assert.ok(executed.length > 0, 'la llamada llega a la base: el respaldo por palabra clave sigue activo');
});
