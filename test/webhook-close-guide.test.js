const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
const writes = [];
let closeDraft = null;
const user = { id: 7, nombre: 'Operario QA', telefono: '573150000059', activo: 1,
  rol_nombre: 'admin', email: 'qa@wms.co' };

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { createConnection: async () => {
    let closed = false;
    return {
      async execute(sql, params = []) {
        if (closed) throw new Error('DB connection already closed');
        writes.push({ sql: String(sql), params });
        if (/FROM usuarios u\s+LEFT JOIN roles r/u.test(sql)) return [[user]];
        if (/FROM bodegas WHERE activa = 1/u.test(sql)) return [[{ id: 1 }]];
        if (/FROM produccion_cierre_borradores/u.test(sql)) return [closeDraft
          ? [{ payload_json: closeDraft }] : []];
        if (/FROM ordenes_produccion op JOIN productos p/u.test(sql)) return [[{
          id: 97, codigo_orden: 'OP-20260924-000097', estado: 'EN_PROCESO',
          cantidad_planeada: '2.000', producto_id: 74,
          sku: '00102-PTASH60', producto: 'ASHWAGANDHA X 60',
        }]];
        if (/INSERT INTO produccion_cierre_borradores/u.test(sql)) closeDraft = params[2];
        if (/^\s*INSERT/u.test(sql)) return [{ insertId: 101, affectedRows: 1 }];
        if (/^\s*UPDATE/u.test(sql)) return [{ affectedRows: 1 }];
        return [[]];
      },
      async query(sql, params) { return this.execute(sql, params); },
      async beginTransaction() {}, async commit() {}, async rollback() {},
      async end() { closed = true; },
    };
  } },
};

process.env.BUILDERBOT_WEBHOOK_SECRET = 'qa-webhook-secret';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
const handler = require('../api/v1/webhook/builderbot');

async function invoke(action, text, params = {}) {
  const req = { method: 'POST', headers: { 'x-builderbot-secret': 'qa-webhook-secret' },
    body: { from: user.telefono, body: text,
      info: { '@ction': action, body: text, params } } };
  const res = { statusCode: 200, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, end() { return this; } };
  await handler(req, res);
  return res;
}

test('un cierre incompleto devuelve la pregunta y finaliza la bandeja antes de cerrar DB', async () => {
  writes.length = 0;
  closeDraft = null;
  const res = await invoke('CERRAR_ORDEN_PRODUCCION', 'Cerramos producción OPIV 97', { id_orden: 97 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.mensaje, /¿Cuántas unidades conformes/iu);
  assert.ok(writes.some(entry => /INSERT INTO produccion_cierre_borradores/u.test(entry.sql)));
  assert.ok(writes.some(entry => /UPDATE webhook_ingress_inbox[\s\S]*status = 'PROCESSED'/u.test(entry.sql)));
  assert.ok(!writes.some(entry => /INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));

  const quantity = await invoke('MODO_CHARLA', '2 conformes', { texto: 'Entendido' });
  assert.match(quantity.body.mensaje, /0 merma/u);
  const waste = await invoke('REPORTE_MERMA', '0 merma', { motivo: 'merma' });
  assert.match(waste.body.mensaje, /ubicación quedará/iu);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock/u.test(entry.sql)));
});

test('un número de OP aclarado en conversación queda pendiente y sí continúa el cierre', async () => {
  writes.length = 0;
  closeDraft = null;
  const first = await invoke('CERRAR_ORDEN_PRODUCCION', 'Cerramos producción OCID 97', { id_orden: 97 });
  assert.match(first.body.mensaje, /¿Te refieres al cierre de \*OP ID 97\*/u);
  const second = await invoke('MODO_CHARLA', 'El 97', { texto: 'Repite el OP ID' });
  assert.match(second.body.mensaje, /OP ID 97/u);
  const third = await invoke('MODO_CHARLA', 'Sí', { texto: 'Entendido' });
  assert.match(third.body.mensaje, /¿Cuántas unidades conformes salieron/iu);
  assert.ok(!writes.some(entry => /UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('un reporte suelto de material dañado no se confunde con el cierre en curso', async () => {
  writes.length = 0;
  closeDraft = null;
  await invoke('CERRAR_ORDEN_PRODUCCION', 'Cerramos producción OP ID 97', { id_orden: 97 });
  const res = await invoke('MODO_CHARLA', 'merma de dos liners');
  assert.match(res.body.mensaje, /únicamente al \*cerrar la producción\*/u);
  assert.ok(!writes.some(entry => /INSERT INTO produccion_merma_borradores/u.test(entry.sql)));
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock/u.test(entry.sql)));
});
