const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
const writes = [];
let closeDraft = null;
let latestStartedNotice = null;
let latestReleasedNotice = null;
let lastWorkflowAction = null;
let pickReview = null;
let pickAllocations = null;
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
        if (/FROM produccion_alistamiento_revisiones/u.test(sql)) return [pickReview
          ? [{ order_id: pickReview.orderId, huella: pickReview.hash,
            choice_json: pickReview.choice }] : []];
        if (/SELECT action FROM webhook_logs/u.test(sql)) return [lastWorkflowAction
          ? [{ action: lastWorkflowAction }] : []];
        if (pickAllocations && /FROM ordenes_produccion op JOIN productos p/u.test(sql)
          && /op\.fase/u.test(sql)) return [[{ id: params[0], codigo_orden: `OP-20260930-${String(params[0]).padStart(6, '0')}`,
            estado: 'APROBADA', fase: 'F0', producto_sku: '00102-PTASH60',
            producto_nombre: 'ASHWAGANDHA X 60' }]];
        if (pickAllocations && /FROM produccion_material_lotes pml/u.test(sql)) return [pickAllocations.map(row => ({ ...row }))];
        if (pickAllocations && /FROM stock s/u.test(sql) && /JOIN lots l/u.test(sql)) {
          const stocks = [{ id: 12, lote: 'R5-260923-TRP', ubicacion_id: 2,
            ubicacion: 'A10', cantidad: 10, reservada: 0, status: 'DISPONIBLE', vence: null },
          { id: 13, lote: 'R7-260927-TRP', ubicacion_id: 2, ubicacion: 'A10',
            cantidad: 10, reservada: 0, status: 'DISPONIBLE', vence: '2027-12-31' },
          { id: 14, lote: 'R8-260928-TRP', ubicacion_id: 1, ubicacion: 'A11',
            cantidad: 10, reservada: 0, status: 'DISPONIBLE', vence: '2028-06-30' }];
          return [/UPPER\(s\.lote\)/u.test(sql)
            ? stocks.filter(stock => stock.lote === params[2]
              && (!params[5] || stock.id === Number(params[5])))
            : stocks.filter(stock => !params[2] || stock.ubicacion === params[2])];
        }
        if (/FROM lots/u.test(sql) && /UPPER\(lpn\)/u.test(sql)) return [params[0] === '123456'
          ? [] : [{ id: 1, lpn: String(params[0]).toUpperCase(), qty_current: 100,
            status: 'DISPONIBLE', bodega_id: 1 }]];
        if (/FROM stock s JOIN ubicaciones u/u.test(sql)) return [[{
          id: 1, ubicacion_id: 8, cantidad: 100, reservada: 0, ubicacion: 'A8',
        }]];
        if (/FROM notificaciones_salida/u.test(sql)) return [/production_released/u.test(sql)
          ? (latestReleasedNotice ? [{ evento: `production_released:${latestReleasedNotice}` }] : [])
          : (latestStartedNotice ? [{ evento: `production_started:${latestStartedNotice}` }] : [])];
        if (/FROM ordenes_produccion op JOIN productos p/u.test(sql)) return [[{
          id: params[0], codigo_orden: `OP-20260924-${String(params[0]).padStart(6, '0')}`,
          estado: 'EN_PROCESO',
          cantidad_planeada: params[0] === 101 ? '3.000' : '2.000', producto_id: 74,
          sku: '00102-PTASH60', producto: 'ASHWAGANDHA X 60',
        }]];
        if (/FROM ubicaciones u JOIN bodegas b/u.test(sql)) return [[{ codigo: String(params[0]).toUpperCase() }]];
        if (/FROM produccion_materiales pm JOIN productos/u.test(sql)) return [[{
          producto_id: 6, unidad: 'und', sku: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
        }]];
        if (pickAllocations && /FROM producto_aliases pa/u.test(sql)
          && params[0] === 'tarros') return [[{
            id: 6, siigo_code: '00006-TRP', nombre: 'TARRO CUADRADO x 60',
            unit_label: 'und', alias: 'tarros',
          }]];
        if (/FROM producto_aliases pa/u.test(sql)) return [[{
          id: 6, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
          unit_label: 'und', alias: 'tapa',
        }]];
        if (pickAllocations && /FROM productos p/u.test(sql)
          && /LEFT JOIN producto_aliases pa/u.test(sql)) return [[{
            id: 6, siigo_code: '00006-TRP', nombre: 'TARRO CUADRADO x 60',
          }]];
        if (pickAllocations && /UPDATE produccion_material_lotes/u.test(sql)) {
          pickAllocations[0].stock_id = params[0];
          pickAllocations[0].lote = params[1];
          pickAllocations[0].ubicacion_id = params[2];
          pickAllocations[0].cantidad_reservada = params[3];
          pickAllocations[0].ubicacion = 'A10';
          return [{ affectedRows: 1 }];
        }
        if (/INSERT INTO produccion_alistamiento_revisiones/u.test(sql)) {
          pickReview = { orderId: params[1], hash: params[2], choice: params[3] };
          return [{ affectedRows: 1 }];
        }
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
  assert.match(quantity.body.mensaje, /0 no conformes/u);
  const waste = await invoke('REPORTE_MERMA', '0 merma', { motivo: 'merma' });
  assert.match(waste.body.mensaje, /ubicación quedará/iu);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock/u.test(entry.sql)));
});

test('una corrección PT respaldada por el audio vuelve al borrador aunque BBC diga modo charla', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 101, conforming: 2, waste: 0,
    wasteClassified: true, reason: null, location: 'C2', materials: [],
    materialsAnswered: true, materialPending: null, reviewShown: true });
  try {
    const res = await invoke('MODO_CHARLA', 'las buenas, destino C1', {
      correccion_pt: [{ campo: 'ubicacion', valor: 'C1', evidencia: 'las buenas, destino C1' }],
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.mensaje, /Ubicación del conforme: C1/u);
    assert.equal(JSON.parse(closeDraft).location, 'C1');
    assert.ok(!writes.some(entry => /UPDATE stock|UPDATE lots|UPDATE ordenes_produccion/u.test(entry.sql)));
  } finally {
    closeDraft = null;
  }
});

test('una ubicación negada mal clasificada como confirmación de alistamiento no inicia la OP', async () => {
  writes.length = 0;
  closeDraft = null;
  const res = await invoke('CONFIRMAR_MATERIALES_PRODUCCION',
    'los dos no estaban en la ubicación a 11 estaban en la ubicación a 10',
    { id_orden: 110 });
  assert.equal(res.statusCode, 200);
  assert.match(res.body.mensaje, /Indica la OP que vas a alistar/u);
  assert.ok(!writes.some(entry => /UPDATE stock|UPDATE lots|UPDATE ordenes_produccion|INSERT INTO movimientos/u.test(entry.sql)));
});

test('una corrección después del resumen de cierre conserva ese contexto aunque BBC diga alistamiento', async () => {
  writes.length = 0;
  lastWorkflowAction = 'CERRAR_ORDEN_PRODUCCION';
  closeDraft = JSON.stringify({ orderId: 101, conforming: 3, waste: 0,
    wasteClassified: true, reason: null, location: 'C2', materials: [],
    materialsAnswered: false, materialPending: null, reviewShown: false,
    candidateOrderId: null });
  try {
    const res = await invoke('CONFIRMAR_MATERIALES_PRODUCCION',
      'corrección, la ubicación del terminado es C2', { id_orden: 101 });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.mensaje, /OP ID 101 — cierre en borrador/u);
    assert.doesNotMatch(res.body.mensaje, /Revisa el alistamiento/u);
    assert.ok(!writes.some(entry => /UPDATE stock|UPDATE lots|UPDATE ordenes_produccion/u.test(entry.sql)));
  } finally {
    lastWorkflowAction = null;
    closeDraft = null;
  }
});

test('un número de lote repetido después de guardarlo vuelve al resumen aunque BBC diga modo charla', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 115, conforming: 2, waste: 0,
    wasteClassified: true, reason: null, location: 'C2', materials: [],
    materialsAnswered: true, materialPending: null, materialChoice: null,
    reviewShown: true, candidateOrderId: null });
  try {
    const res = await invoke('MODO_CHARLA', 'opción 2', {
      texto: '¿A qué lote o partida te refieres con «opción 2»?',
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.mensaje, /OP ID 115 — cierre en borrador/u);
    assert.match(res.body.mensaje, /Resumen para confirmar/u);
    assert.doesNotMatch(res.body.mensaje, /¿A qué lote o partida/u);
    assert.ok(!writes.some(entry => /UPDATE stock|UPDATE lots|UPDATE ordenes_produccion/u.test(entry.sql)));
  } finally {
    closeDraft = null;
  }
});

test('el webhook mantiene OP y partida entre el resumen y la corrección de alistamiento', async () => {
  writes.length = 0;
  closeDraft = null;
  pickReview = null;
  pickAllocations = [{ id: 501, produccion_material_id: 10, stock_id: 11,
    lote: 'R5-260923-TRP', ubicacion_id: 1, cantidad_reservada: 7,
    producto_id: 6, unidad: 'und', bodega_id: 1, sku: '00006-TRP',
    producto: 'TARRO CUADRADO x 60', ubicacion: 'A11' }];
  try {
    const preview = await invoke('MODO_CHARLA', 'Revisa materiales OP ID 110');
    assert.match(preview.body.mensaje, /Revisa el alistamiento de OP ID 110/u);
    assert.equal(pickReview.orderId, 110);
    lastWorkflowAction = 'CONFIRMAR_MATERIALES_PRODUCCION';
    const correction = await invoke('MODO_CHARLA', 'corrección: partida 1, ubicación A10');
    assert.match(correction.body.mensaje, /elige el lote/u);
    assert.equal(pickAllocations[0].stock_id, 11);
    const choice = await invoke('MODO_CHARLA', 'opción 2');
    assert.match(choice.body.mensaje, /Corrección aplicada a la partida 1/u);
    assert.match(choice.body.mensaje, /ubicación: A10/u);
    assert.match(choice.body.mensaje, /Lote: R7-260927-TRP/u);
    assert.equal(pickAllocations[0].stock_id, 13);
    assert.ok(!writes.some(entry => /UPDATE stock\s+SET cantidad = cantidad -|UPDATE ordenes_produccion\s+SET fase/u.test(entry.sql)));
  } finally {
    pickReview = null;
    pickAllocations = null;
    lastWorkflowAction = null;
  }
});

test('MODO_CHARLA no impone partida si «cambiar lote de tarros» identifica una sola del alistamiento', async () => {
  writes.length = 0;
  closeDraft = null;
  pickReview = null;
  pickAllocations = [{ id: 501, produccion_material_id: 10, stock_id: 11,
    lote: 'R5-260923-TRP', ubicacion_id: 1, cantidad_reservada: 7,
    producto_id: 6, unidad: 'und', bodega_id: 1, sku: '00006-TRP',
    producto: 'TARRO CUADRADO x 60', ubicacion: 'A11' }];
  try {
    await invoke('MODO_CHARLA', 'Revisa materiales OP ID 110');
    lastWorkflowAction = 'CONFIRMAR_MATERIALES_PRODUCCION';
    const correction = await invoke('MODO_CHARLA', 'Cambiar lote de tarros', {
      texto: '¿Qué partida de tarros quieres corregir? Indica el número de partida.',
    });
    assert.equal(correction.statusCode, 200);
    assert.match(correction.body.mensaje, /Partida 1: TARRO CUADRADO/u);
    assert.match(correction.body.mensaje, /Lote R8-260928-TRP/u);
    assert.doesNotMatch(correction.body.mensaje, /Qué partida de tarros/u);
    assert.equal(pickAllocations[0].stock_id, 11);
  } finally {
    pickReview = null;
    pickAllocations = null;
    lastWorkflowAction = null;
  }
});

test('alistador con audio parcial de ubicación permanece en OP 111, no entra al cierre', async () => {
  writes.length = 0;
  user.rol_nombre = 'alistador';
  user.roles = ['alistador'];
  lastWorkflowAction = 'CERRAR_ORDEN_PRODUCCION';
  latestReleasedNotice = 111;
  pickReview = null;
  pickAllocations = [
    { id: 501, produccion_material_id: 10, stock_id: 11,
      lote: 'R10-260925-LINER', ubicacion_id: 14, cantidad_reservada: 1,
      producto_id: 35, unidad: 'und', bodega_id: 1, sku: '00035-LNTP60',
      producto: 'LINER TARRO x 60', ubicacion: 'A14' },
    { id: 502, produccion_material_id: 10, stock_id: 12,
      lote: 'AA-260929-01-LINER', ubicacion_id: 14, cantidad_reservada: 4,
      producto_id: 35, unidad: 'und', bodega_id: 1, sku: '00035-LNTP60',
      producto: 'LINER TARRO x 60', ubicacion: 'A14' },
  ];
  try {
    const res = await invoke('CERRAR_ORDEN_PRODUCCION', 'a10 y no de la a14');
    assert.equal(res.statusCode, 200);
    assert.match(res.body.mensaje, /En A14 hay varias partidas \(1 y 2\)/u);
    assert.match(res.body.mensaje, /OP ID 111/u);
    assert.doesNotMatch(res.body.mensaje, /No tienes permiso|cierre en borrador/u);
    assert.ok(!writes.some(entry => /UPDATE stock|UPDATE lots|UPDATE ordenes_produccion|INSERT INTO movimientos/u.test(entry.sql)));
  } finally {
    user.rol_nombre = 'admin';
    delete user.roles;
    lastWorkflowAction = null;
    latestReleasedNotice = null;
    pickReview = null;
    pickAllocations = null;
  }
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

test('mensaje escrito «se dañaron 2 tapas por ruptura» continúa el cierre de OP 101', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 101, conforming: 3, waste: 0,
    wasteClassified: true, reason: null, location: 'C2', materials: [],
    materialsAnswered: false, materialPending: null, reviewShown: false,
    candidateOrderId: null });
  const res = await invoke('MODO_CHARLA', 'se dañaron 2 tapas por ruptura');
  assert.equal(res.statusCode, 200);
  assert.match(res.body.mensaje, /¿Repusiste 2 und de TAPA/u);
  const draft = JSON.parse(closeDraft);
  assert.equal(draft.orderId, 101);
  assert.equal(draft.materialPending.sku, '00001-TPBI');
  assert.equal(draft.materialPending.cantidad, 2);
  assert.equal(draft.materialPending.motivo, 'ruptura');
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('si la IA clasifica el daño como REPORTE_MERMA, permanece en el cierre abierto', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 101, conforming: 3, waste: 0,
    wasteClassified: true, reason: null, location: 'C2', materials: [],
    materialsAnswered: false, materialPending: null, reviewShown: false,
    candidateOrderId: null });
  const res = await invoke('REPORTE_MERMA', 'se dañaron 2 tapas por ruptura', {
    id_item: '00001-TPBI', cantidad: 2, motivo: 'ruptura',
  });
  assert.match(res.body.mensaje, /¿Repusiste 2 und de TAPA/u);
  assert.equal(JSON.parse(closeDraft).materialPending.motivo, 'ruptura');
  assert.ok(!writes.some(entry => /INSERT INTO produccion_merma_borradores|INSERT INTO mermas|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
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

test('WhatsApp corrige por alias el lote de una partida ya resumida sin repetir OP ID', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 97, conforming: 2, waste: 0,
    reason: null, location: 'C2', materialsAnswered: true, materialPending: null,
    reviewShown: true, materials: [{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      cantidad: 2, unidad: 'und', lote: 'ACC-260910-TPBI', motivo: 'destruccion' }] });
  const res = await invoke('MODO_CHARLA', 'correción, las 2 tapas salieron de R2-260920-TPBI', {
    avance_materiales: { correccion_lote: {
      producto: 'tapas', cantidad: 2, lote: 'R2-260920-TPBI',
    } },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(closeDraft).materials[0].lote, 'R2-260920-TPBI');
  assert.match(res.body.mensaje, /Lote de reposición: R2-260920-TPBI/u);
  assert.doesNotMatch(res.body.mensaje, /ACC-260910-TPBI/u);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('WhatsApp rechaza el lote 123456 al corregir y bloquea confirmar cierre', async () => {
  writes.length = 0;
  closeDraft = JSON.stringify({ orderId: 101, conforming: 3, waste: 0,
    wasteClassified: true, reason: null, location: 'C2', materialsAnswered: true,
    materialPending: null, reviewShown: true, materials: [{ sku: '00001-TPBI',
      producto: 'TAPA TARRO CUADRADO BLANCO', cantidad: 2, unidad: 'und',
      lote: 'R4-260921-TPBI', motivo: 'ruptura' }] });
  const invalid = await invoke('MODO_CHARLA', 'corrección, las 2 tapas salieron del lote 123456');
  assert.match(invalid.body.mensaje, /lote \*123456\* no está registrado/u);
  assert.equal(JSON.parse(closeDraft).materials[0].lote, null);
  const premature = await invoke('MODO_CHARLA', 'confirmo cierre');
  assert.doesNotMatch(premature.body.mensaje, /Producción cerrada/u);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
});

test('audio «Orden OPIV 101» inicia borrador de cierre si coincide con el último aviso al encargado', async () => {
  writes.length = 0;
  closeDraft = null;
  latestStartedNotice = 101;
  const res = await invoke('UNKNOWN', 'Orden OPIV 101');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.mensaje, /OP ID 101/u);
  assert.match(res.body.mensaje, /¿Cuántas unidades de producto terminado salieron conformes/iu);
  assert.equal(JSON.parse(closeDraft).orderId, 101);
  assert.ok(!writes.some(entry => /INSERT INTO mermas|INSERT INTO lots|INSERT INTO stock|UPDATE ordenes_produccion/u.test(entry.sql)));
  latestStartedNotice = null;
});

test('una referencia OPIV aislada no inicia cierre si el aviso reciente corresponde a otra orden', async () => {
  writes.length = 0;
  closeDraft = null;
  latestStartedNotice = 100;
  const res = await invoke('UNKNOWN', 'Orden OPIV 101');
  assert.equal(res.statusCode, 200);
  assert.equal(closeDraft, null);
  assert.ok(!writes.some(entry => /INSERT INTO produccion_cierre_borradores|UPDATE ordenes_produccion/u.test(entry.sql)));
  latestStartedNotice = null;
});

test('una referencia OPIV aislada no abre cierre desde el rol de alistamiento', async () => {
  writes.length = 0;
  closeDraft = null;
  latestStartedNotice = 101;
  user.rol_nombre = 'alistador';
  try {
    await invoke('UNKNOWN', 'Orden OPIV 101');
    assert.equal(closeDraft, null);
    assert.ok(!writes.some(entry => /INSERT INTO produccion_cierre_borradores|UPDATE ordenes_produccion/u.test(entry.sql)));
  } finally {
    user.rol_nombre = 'admin';
    latestStartedNotice = null;
  }
});
