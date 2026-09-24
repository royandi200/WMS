const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceWasteGuide, parseCauseReply, parseWasteMessage, recentOrderContext,
} = require('../api/_lib/production-waste-guide');

test('merma spoken in two audios keeps quantity and product while waiting for the actual cause', async () => {
  let stored = null;
  const db = { async execute(sql, params) {
    if (sql.includes('FROM produccion_merma_borradores')) return [stored ? [{ payload_json: stored }] : []];
    if (sql.includes('FROM webhook_logs')) return [[{
      action: 'REPORTE_MERMA', payload: JSON.stringify({ info: JSON.stringify({ params: {
        id_orden: 'OP ID 97',
      } }) }),
    }]];
    if (sql.includes('FROM notificaciones_salida')) return [[]];
    if (sql.includes('FROM ordenes_produccion')) return [[{
      id: 97, codigo_orden: 'OP-20260924-000097', estado: 'EN_PROCESO',
    }]];
    if (sql.includes('FROM produccion_materiales')) return [[
      { producto_id: 1, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und' },
      { producto_id: 17, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA', unidad: 'und' },
    ]];
    if (sql.includes('FROM productos p') && sql.includes('p.id = ?')) return [params[1] === '00001-TPBI'
      ? [{ id: 1, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO' }] : []];
    if (sql.includes('FROM producto_aliases pa')) return [[]];
    if (sql.includes('FROM productos p') && sql.includes('pa.alias')) return [[
      { id: 1, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: 'tapa' },
      { id: 17, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA', alias: 'etiqueta' },
    ]];
    if (sql.includes('INSERT INTO produccion_merma_borradores')) {
      stored = params[2]; return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const first = await advanceWasteGuide({ db, userId: 7, from: '573001234567',
    rawText: 'reporta merma de una etapa', params: { motivo: 'merma' } });
  assert.match(first.message, /OP ID 97/u);
  assert.match(first.message, /TAPA TARRO/u);
  assert.match(first.message, /Cantidad: 1 und/u);
  assert.match(first.message, /causa concreta/u);
  assert.equal(first.draft.cause, null);
  const second = await advanceWasteGuide({ db, userId: 7, from: '573001234567',
    rawText: 'ruptura', params: {} });
  assert.deepEqual(second.params, { id_orden: 97, id_item: '00001-TPBI',
    cantidad: 1, motivo: 'ruptura' });
});

test('ambiguity never silently chooses between two recently discussed OPs', async () => {
  const db = { async execute() { return [[
    { action: 'REPORTE_MERMA', payload: JSON.stringify({ info: { params: { id_orden: 97 } } }) },
    { action: 'REPORTE_MERMA', payload: JSON.stringify({ info: { params: { id_orden: 98 } } }) },
  ]]; } };
  assert.equal(await recentOrderContext(db, '573001234567'), null);
});

test('a single production-start notification gives the recipient safe OP context', async () => {
  const db = { async execute(sql) {
    if (sql.includes('FROM webhook_logs')) return [[]];
    if (sql.includes('FROM notificaciones_salida')) return [[{
      evento: 'production_started:98',
    }]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  assert.equal(await recentOrderContext(db, '573001234567'), 98);
});

test('notifications for different OPs do not silently choose a production order', async () => {
  const db = { async execute(sql) {
    if (sql.includes('FROM webhook_logs')) return [[]];
    if (sql.includes('FROM notificaciones_salida')) return [[
      { evento: 'production_started:98' }, { evento: 'production_started:97' },
    ]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  assert.equal(await recentOrderContext(db, '573001234567'), null);
});

test('an old chat OP and a new notified OP remain ambiguous', async () => {
  const db = { async execute(sql) {
    if (sql.includes('FROM webhook_logs')) return [[{
      action: 'REPORTE_MERMA', payload: JSON.stringify({ info: { params: { id_orden: 97 } } }),
    }]];
    if (sql.includes('FROM notificaciones_salida')) return [[{ evento: 'production_started:98' }]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  assert.equal(await recentOrderContext(db, '573001234567'), null);
});

test('short cause and explicit-cause variants are identified, not inferred from generic waste', () => {
  assert.deepEqual(parseWasteMessage('Reporta merma de una tapa'), {
    product: 'tapa', quantity: 1, cause: null,
  });
  assert.deepEqual(parseWasteMessage('Se perdió una tapa por ruptura'), {
    product: 'tapa', quantity: 1, cause: 'ruptura',
  });
  assert.equal(parseCauseReply('ruptura'), 'ruptura');
  assert.equal(parseCauseReply('motivo: rotura'), 'rotura');
  assert.equal(parseCauseReply('confirma materiales'), null);
});
