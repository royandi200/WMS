const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
const guidedPath = path.resolve(__dirname, '../api/_lib/builderbot-guided-reception.js');
const executed = [];
const guided = require(guidedPath);
let routed = null;

require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { createConnection: async () => ({
    async execute(sql, params = []) {
      executed.push(String(sql));
      if (/FROM usuarios u\s+LEFT JOIN roles r/u.test(sql)) return [[{
        id: 5, nombre: 'Operario QA', telefono: '573150000059', activo: 1,
        rol_nombre: 'admin', email: 'qa@wms.co',
      }]];
      if (/FROM bodegas WHERE activa = 1/u.test(sql)) return [[{ id: 1 }]];
      if (/^\s*INSERT/iu.test(sql)) return [{ insertId: 1 }];
      return [[]];
    },
    async query(sql, params) { return this.execute(sql, params); },
    async beginTransaction() {}, async commit() {}, async rollback() {}, async end() {},
  }) },
};
require.cache[guidedPath] = {
  id: guidedPath, filename: guidedPath, loaded: true,
  exports: {
    ...guided,
    hasRecentReceptionContext: async () => true,
    advanceGuidedReception: async input => {
      routed = input;
      return { message: 'Corrección de recepción OC ID 45: partida 2 en A2',
        reception_id: 145, purchase_order_id: 45, reception_number: 'REC-OC-45-001',
        inventory_changed: false };
    },
  },
};

process.env.BUILDERBOT_WEBHOOK_SECRET = 'qa-webhook-secret';
process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
const handler = require('../api/v1/webhook/builderbot');

test('a misclassified production correction follows the last reception preview', async () => {
  const text = 'Corrección, ubicación de la partida 2 de las gomas es A2';
  const req = { method: 'POST', headers: { 'x-builderbot-secret': 'qa-webhook-secret' },
    body: { from: '573150000059', body: text,
      info: { '@ction': 'CERRAR_ORDEN_PRODUCCION', body: text,
        params: { id_orden: 109, ubicacion: 'A2' } } } };
  const res = { statusCode: 200, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, end() { return this; } };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.mensaje, /Corrección de recepción \*?OC ID 45/u);
  assert.equal(routed.params.correccion, true);
  assert.equal(routed.params.id_orden, undefined);
  assert.doesNotMatch(executed.join('\n'), /FROM produccion_cierre_borradores/u);
  assert.doesNotMatch(executed.join('\n'), /INSERT INTO (?:stock|lots|kardex)/u);
});
