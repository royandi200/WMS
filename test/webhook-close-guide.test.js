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
        if (/FROM produccion_materiales pm JOIN productos/u.test(sql)) return [[{
          producto_id: 6, unidad: 'und', sku: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
        }]];
        if (/FROM producto_aliases pa/u.test(sql)) return [[{
          id: 6, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
          unit_label: 'und', alias: 'tapa',
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
  assert.match(res.body.mensaje, /¿Cuántas unidades de producto terminado salieron conformes/iu);
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
  assert.match(third.body.mensaje, /¿Cuántas unidades de producto terminado salieron conformes/iu);
  assert.ok(!writes.some(entry => /UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('un reporte de material dañado continúa el cierre en curso sin registrar merma anticipada', async () => {
  writes.length = 0;
  closeDraft = null;
  await invoke('CERRAR_ORDEN_PRODUCCION', 'Cerramos producción OP ID 97', { id_orden: 97 });
  const res = await invoke('MODO_CHARLA', 'hubo merma de dos tapas por destrucción');
  assert.equal(res.statusCode, 200);
  assert.match(res.body.mensaje, /¿Repusiste 2 und de TAPA/u);
  assert.equal(JSON.parse(closeDraft).materialPending.sku, '00001-TPBI');
  assert.equal(JSON.parse(closeDraft).waste, null);
  assert.ok(!writes.some(entry => /INSERT INTO produccion_merma_borradores/u.test(entry.sql)));
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock/u.test(entry.sql)));
});

test('un borrador antiguo pregunta qué fue la merma y acepta el alias sin repetir OP ID', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 97, conforming: null, waste: 1, reason: null,
    location: null, materials: [], materialsAnswered: false, materialPending: null,
    reviewShown: false, candidateOrderId: null });
  const old = await invoke('CERRAR_ORDEN_PRODUCCION', 'cerrar OP ID 97', { id_orden: 97 });
  assert.match(old.body.mensaje, /¿Fue \*producto terminado\* o un \*insumo\*/u);
  const alias = await invoke('MODO_CHARLA', 'tapas');
  assert.equal(alias.statusCode, 200);
  assert.match(alias.body.mensaje, /¿Cuántas und de TAPA/u);
  assert.equal(JSON.parse(closeDraft).materialPending.cantidad, null);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('WhatsApp conserva el contexto y acepta sí con lote en el mismo mensaje', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 97, conforming: null, waste: null,
    reason: null, location: null, materials: [], materialsAnswered: false,
    reviewShown: false, candidateOrderId: null,
    materialPending: { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 2, motivo: 'destruccion', lote: null,
      ubicacion: null, damageReport: true, replacementDecision: null } });
  const res = await invoke('MODO_CHARLA', 'Sí, fueron sacadas del lote ACC-260910-TPBI');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(closeDraft).materialPending, null);
  assert.equal(JSON.parse(closeDraft).materials[0].lote, 'ACC-260910-TPBI');
  assert.match(res.body.mensaje, /Insumo repuesto: 2 und/u);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('la lectura contextual de IA llega al cierre y el WMS valida el lote mencionado', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 97, conforming: null, waste: null,
    reason: null, location: null, materials: [], materialsAnswered: false,
    reviewShown: false, candidateOrderId: null,
    materialPending: { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 2, motivo: 'destruccion', lote: null,
      ubicacion: null, damageReport: true, replacementDecision: null } });
  const res = await invoke('MODO_CHARLA', 'Claro, las tomé de la partida ACC 260910 TPBI', {
    avance_materiales: { confirmacion_reposicion: true, lote_reposicion: 'ACC-260910-TPBI' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(closeDraft).materials[0].lote, 'ACC-260910-TPBI');
  assert.match(res.body.mensaje, /Insumo repuesto: 2 und/u);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
});
