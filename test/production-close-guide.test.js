const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceCloseGuide, closeFields, closeOrderReference, confirmed, isCloseFollowup,
} = require('../api/_lib/production-close-guide');
const { hasProductionCloseIntent } = require('../api/_lib/production-close-input');

function fakeDb({ orderId = 97, planned = 2, initialDraft = null,
  invalidLots = [], stockAvailable = 100, replacementOptions = null } = {}) {
  let stored = initialDraft;
  let freeStock = stockAvailable;
  const writes = [];
  const queries = [];
  const aliasTerms = [];
  return {
    writes, queries, aliasTerms,
    setFreeStock(value) { freeStock = value; },
    async execute(sql, params) {
      queries.push(sql);
      if (sql.includes('FROM produccion_cierre_borradores')) return [stored ? [{ payload_json: stored }] : []];
      if (sql.includes('FROM lots') && sql.includes('UPPER(lpn)')) return [invalidLots.includes(params[0])
        ? [] : [{ id: 1, lpn: String(params[0]).toUpperCase(), qty_current: 100,
          status: 'DISPONIBLE', bodega_id: 1 }]];
      if (sql.includes('FROM stock s JOIN lots l')) return [(replacementOptions || [
        { lote: 'ACC-260910-TPBI', ubicacion: 'A8', disponible: freeStock, vence: '2027-09-30' },
        { lote: 'R5-260923-LINER', ubicacion: 'A14', disponible: freeStock, vence: '2028-06-30' },
      ]).filter(row => Number(row.disponible) >= Number(params[1])
        && (replacementOptions || (Number(params[0]) === 35 ? row.ubicacion === 'A14' : row.ubicacion === 'A8'))
        && (!params[3] || row.ubicacion === params[3]))];
      if (sql.includes('FROM stock s JOIN ubicaciones u')) return [[{
        id: 1, ubicacion_id: Number(params[0]) === 35 ? 14 : 8,
        cantidad: freeStock, reservada: 0, ubicacion: Number(params[0]) === 35 ? 'A14' : 'A8',
      }]];
      if (sql.includes('FROM webhook_logs')) return [[]];
      if (sql.includes('FROM notificaciones_salida')) return [[{ evento: `production_started:${orderId}` }]];
      if (sql.includes('FROM ordenes_produccion op')) return [[{
        id: orderId, codigo_orden: `OP-20260924-${String(orderId).padStart(6, '0')}`, estado: 'EN_PROCESO',
        cantidad_planeada: Number(planned).toFixed(3), producto_id: 74,
        sku: '00102-PTASH60', producto: 'ASHWAGANDHA X 60',
      }]];
      if (sql.includes('FROM producto_ubicaciones')) return [[{ codigo: 'C2' }]];
      if (sql.includes('FROM ubicaciones u JOIN bodegas b')) return [[{ codigo: String(params[0]).toUpperCase() }]];
      if (sql.includes('FROM produccion_materiales pm JOIN productos')) return [[{
        producto_id: 6, unidad: 'und', sku: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
      }, { producto_id: 17, unidad: 'und', sku: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA' },
      { producto_id: 35, unidad: 'und', sku: '00035-LNTP60', nombre: 'LINER TARRO x 60' }]];
      if (sql.includes('FROM productos p') && sql.includes('LEFT JOIN skus')) return [[]];
      if (sql.includes('FROM producto_aliases pa')) { aliasTerms.push(params[0]); return [[/^liners?$/u.test(params[0]) ? {
        id: 35, siigo_code: '00035-LNTP60', nombre: 'LINER TARRO x 60',
        unit_label: 'und', alias: 'liners',
      } : params[0] === 'etiqueta' ? {
        id: 17, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA',
        unit_label: 'und', alias: 'etiqueta',
      } : {
        id: 6, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
        unit_label: 'und', alias: 'tapa',
      }]]; }
      if (sql.includes('INSERT INTO produccion_cierre_borradores')) {
        stored = params[2]; writes.push(sql); return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('cierre guiado conserva datos entre audios y solo entrega parámetros tras revisar y confirmar', async () => {
  const db = fakeDb();
  const base = { db, userId: 7 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'Cerramos producción OPIV 97', params: { id_orden: 97 } });
  assert.match(first.message, /OP ID 97/u);
  assert.match(first.message, /2 und/u);
  assert.match(first.message, /Ubicación sugerida para el producto terminado conforme: \*C2\*/u);
  assert.match(first.message, /¿Cuántas unidades de producto terminado salieron conformes/iu);
  assert.equal(first.params, undefined);

  const second = await advanceCloseGuide({ ...base, rawText: '2 conformes' });
  assert.match(second.message, /Conformes: 2 und/u);
  assert.match(second.message, /Falta:.*cantidad no conforme de producto terminado, ubicación del producto terminado/u);
  assert.match(second.message, /0 no conformes/u);

  const third = await advanceCloseGuide({ ...base, rawText: 'cero merma' });
  assert.match(third.message, /Ubicación sugerida para el producto terminado conforme: \*C2\*/u);

  const fourth = await advanceCloseGuide({ ...base, rawText: 'C2' });
  assert.match(fourth.message, /¿Repusiste algún material/u);
  assert.equal(fourth.params, undefined);

  const fifth = await advanceCloseGuide({ ...base, rawText: 'no repuse material' });
  assert.match(fifth.message, /confirmo cierre/u);
  assert.equal(fifth.params, undefined);
  const sixth = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 97' });
  assert.deepEqual(sixth.params, { id_orden: 97, cantidad_real: 2, merma: 0,
    motivo_merma: null, ubicacion: 'C2', materiales_repuestos: [] });
  assert.equal(db.writes.length, 5);
});

test('confirma con OP ID explícito solo si coincide con el borrador completo y revisado', async () => {
  for (const phrase of ['confirmo cierre OP ID 109',
    'Confirmo el cierre de la OP ID 109',
    'confirmo el cierre de producción de la OP ID 109']) {
    const db = fakeDb({ orderId: 109, planned: 1 });
    const base = { db, userId: 7 };
    const preview = await advanceCloseGuide({ ...base,
      rawText: 'Cerramos OP ID 109: 1 conforme, 0 no conformes, ubicación C2, no repuse material' });
    assert.match(preview.message, /confirmo cierre OP ID 109/u);
    assert.equal(preview.params, undefined);
    const confirmedClose = await advanceCloseGuide({ ...base, rawText: phrase });
    assert.deepEqual(confirmedClose.params, { id_orden: 109, cantidad_real: 1, merma: 0,
      motivo_merma: null, ubicacion: 'C2', materiales_repuestos: [] });
    assert.equal(db.writes.length, 1);
    assert.equal(isCloseFollowup(phrase, preview.draft), true);
  }
});

test('BBC puede envolver el mensaje actual sin perder la confirmación explícita', async () => {
  const db = fakeDb({ orderId: 108, planned: 5 });
  const base = { db, userId: 18 };
  const preview = await advanceCloseGuide({ ...base,
    rawText: 'Cerrar OP ID 108: 5 conformes, 0 no conformes, ubicación C3, no repuse material' });
  assert.doesNotMatch(preview.message, /o \*confirmo cierre\*/u);
  const wrap = text => `{name}="Operario"\n[Wednesday, September 30, 2026 19:49:05]: ${text}`;
  assert.equal(isCloseFollowup(wrap('confirmo cierre'), preview.draft), true);
  assert.equal(isCloseFollowup(wrap('confirmo op 108'), preview.draft), true);
  assert.equal(isCloseFollowup(wrap('confirmo cierre OP ID 108'), preview.draft), true);
  const final = await advanceCloseGuide({ ...base, rawText: wrap('confirmo cierre OP ID 108'),
    params: { id_orden: 108 } });
  assert.equal(final.params.id_orden, 108);
  assert.equal(final.params.ubicacion, 'C3');
  assert.equal(db.writes.length, 1);
});

test('sin OP ID o con uno equivocado, ayuda igual en intentos repetidos y no cierra', async () => {
  const db = fakeDb({ orderId: 108, planned: 5 });
  const base = { db, userId: 19 };
  const preview = await advanceCloseGuide({ ...base,
    rawText: 'Cerrar OP ID 108: 5 conformes, 0 no conformes, ubicación C3, no repuse material' });
  assert.match(preview.message, /responde \*confirmo cierre OP ID 108\*\./u);
  for (const phrase of ['confirmo cierre', 'confirmo cierre',
    'confirmo op 108', 'confirmo op 108',
    'confirmo cierre OP ID 109', 'confirmo cierre OP ID 109']) {
    const reply = await advanceCloseGuide({ ...base, rawText: phrase });
    assert.equal(reply.params, undefined);
    assert.match(reply.message, /confirmo cierre OP ID 108/u);
    assert.match(reply.message, /no se modificó inventario/u);
    assert.equal(reply.draft.orderId, 108);
  }
  assert.equal(db.writes.length, 1);
  const confirmedClose = await advanceCloseGuide({ ...base,
    rawText: 'confirmo cierre OP ID 108' });
  assert.equal(confirmedClose.params.id_orden, 108);
});

test('el cierre pendiente conserva contexto para OP ID y cerrar durante la jornada', async () => {
  const db = fakeDb({ orderId: 108, planned: 5, initialDraft: {
    orderId: 108, conforming: 5, waste: 0, wasteClassified: true,
    reason: null, location: 'C3', materials: [], materialsAnswered: true,
    materialPending: null, reviewShown: true, candidateOrderId: null,
  } });
  const base = { db, userId: 5 };
  const wrap = text => `{name}="Operario"\n[Wednesday, September 30, 2026 20:48:29]: ${text}`;
  assert.equal(isCloseFollowup(wrap('op id 108'), { orderId: 108 }), true);
  assert.equal(isCloseFollowup(wrap('cerrar'), { orderId: 108 }), true);
  const reference = await advanceCloseGuide({ ...base, rawText: wrap('op id 108') });
  assert.equal(reference.params, undefined);
  assert.match(reference.message, /Ubicación del conforme: C3/u);
  assert.match(reference.message, /confirmo cierre OP ID 108/u);
  const close = await advanceCloseGuide({ ...base, rawText: wrap('cerrar') });
  assert.equal(close.params, undefined);
  assert.match(close.message, /confirmo cierre OP ID 108/u);
  assert.doesNotMatch(close.message, /confirma cierre OP ID/u);
  assert.ok(db.queries.some(sql => sql.includes('actualizado_en > DATE_SUB(NOW(), INTERVAL 8 HOUR)')));
  assert.ok(db.writes.some(sql => sql.includes('DATE_ADD(NOW(), INTERVAL 8 HOUR)')));
});

test('una referencia inventada por IA no autoriza el cierre y vuelve a guiar', async () => {
  const db = fakeDb({ orderId: 108, planned: 5 });
  const base = { db, userId: 20 };
  await advanceCloseGuide({ ...base,
    rawText: 'Cerrar OP ID 108: 5 conformes, 0 no conformes, ubicación C3, no repuse material' });
  const mismatch = await advanceCloseGuide({ ...base,
    rawText: 'confirmo cierre OP ID 108', params: { id_orden: 109 } });
  assert.equal(mismatch.params, undefined);
  assert.match(mismatch.message, /No pude verificar la referencia/u);
  assert.match(mismatch.message, /confirmo cierre OP ID 108/u);
  assert.equal(db.writes.length, 1);
});

test('un OP ID distinto o una revisión incompleta no cierran la producción', async () => {
  const db = fakeDb({ orderId: 109, planned: 1 });
  const base = { db, userId: 7 };
  const incomplete = await advanceCloseGuide({ ...base, rawText: 'Cerramos OP ID 109' });
  const premature = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.equal(premature.params, undefined);
  assert.equal(premature.draft.reviewShown, false);
  assert.match(premature.message, /Falta:/u);
  assert.equal(db.writes.length, 2);
  assert.equal(incomplete.params, undefined);

  await advanceCloseGuide({ ...base,
    rawText: '1 conforme, 0 no conformes, ubicación C2, no repuse material' });
  const writesBeforeMismatch = db.writes.length;
  const mismatch = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 110' });
  assert.equal(mismatch.params, undefined);
  assert.match(mismatch.message, /Escribiste OP ID 110, pero el borrador activo es OP ID 109/u);
  assert.match(mismatch.message, /confirmo cierre OP ID 109/u);
  assert.equal(db.writes.length, writesBeforeMismatch);
});

test('transcripciones reales de OP 103 registran conformes y cero no conformes sin repetir la pregunta', async () => {
  const db = fakeDb({ orderId: 103, planned: 10 });
  const base = { db, userId: 23 };
  const first = await advanceCloseGuide({ ...base, rawText: 'cerramos op y de 103',
    params: { id_orden: 103 } });
  assert.match(first.message, /Ubicación sugerida para el producto terminado conforme: \*C2\*/u);
  const amounts = await advanceCloseGuide({ ...base,
    rawText: '10 productos conformes, 0 productos no conformes',
    params: { avance_materiales: { cantidad_real: 10, merma: 0 } } });
  assert.equal(amounts.draft.conforming, 10);
  assert.equal(amounts.draft.waste, 0);
  assert.match(amounts.message, /Conformes: 10 und/u);
  assert.match(amounts.message, /No conformes de producto terminado: 0 und/u);
  assert.doesNotMatch(amounts.message, /Falta:.*cantidad no conforme/u);
  const repeated = await advanceCloseGuide({ ...base, rawText: 'cero productos no conformes' });
  assert.equal(repeated.draft.waste, 0);
  assert.match(repeated.message, /¿En qué ubicación quedará/u);
  assert.equal(repeated.params, undefined);
});

test('el operario puede declarar conformes y no conformes juntos y completar lo faltante por partes', async () => {
  const db = fakeDb({ planned: 20 });
  const base = { db, userId: 7 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'Cerramos OP ID 97: hay 10 conformes y 10 no conformes' });
  assert.equal(first.draft.conforming, 10);
  assert.equal(first.draft.waste, 10);
  assert.equal(first.draft.wasteClassified, true);
  assert.match(first.message, /Conformes: 10 und/u);
  assert.match(first.message, /No conformes de producto terminado: 10 und/u);
  assert.match(first.message, /Falta:.*motivo de la merma.*ubicación del producto terminado.*reposición de insumos/u);
  assert.equal(first.params, undefined);

  const reason = await advanceCloseGuide({ ...base, rawText: 'por ruptura' });
  assert.equal(reason.draft.reason, 'ruptura');
  const location = await advanceCloseGuide({ ...base, rawText: 'C2' });
  assert.equal(location.draft.location, 'C2');
  const preview = await advanceCloseGuide({ ...base, rawText: 'no repuse material' });
  assert.match(preview.message, /Resumen para confirmar/u);
  assert.equal(preview.params, undefined);
  const confirmedClose = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 97' });
  assert.deepEqual(confirmedClose.params, { id_orden: 97, cantidad_real: 10, merma: 10,
    motivo_merma: 'ruptura', ubicacion: 'C2', materiales_repuestos: [] });
});

test('el operario puede dar todos los datos del cierre en un mensaje y aun debe revisar antes de confirmar', async () => {
  const db = fakeDb({ planned: 20 });
  const base = { db, userId: 8 };
  const preview = await advanceCloseGuide({ ...base,
    rawText: 'Cerramos OP ID 97: 10 conformes y 10 no conformes por ruptura, ubicación C2, no repuse material' });
  assert.equal(preview.draft.conforming, 10);
  assert.equal(preview.draft.waste, 10);
  assert.equal(preview.draft.reason, 'ruptura');
  assert.equal(preview.draft.location, 'C2');
  assert.equal(preview.draft.materialsAnswered, true);
  assert.match(preview.message, /Resumen para confirmar/u);
  assert.equal(preview.params, undefined);
  const confirmedClose = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 97' });
  assert.deepEqual(confirmedClose.params, { id_orden: 97, cantidad_real: 10, merma: 10,
    motivo_merma: 'ruptura', ubicacion: 'C2', materiales_repuestos: [] });
});

test('corrige la ubicación del PT con expresiones naturales sin cerrar la OP', async () => {
  for (const phrase of [
    'corrección la ubicación es C3',
    'corrijo: la ubicación correcta es C3',
    'la ubicación del producto terminado será C3',
    'corrección ubicación de C2 a C3',
    'corrección ubicación C2 a C3',
    'corrección la ubicación no es C2, es C3',
    'corrección la ubicación es C 3',
  ]) {
    const db = fakeDb({ orderId: 108, planned: 5 });
    const base = { db, userId: 7 };
    await advanceCloseGuide({ ...base,
      rawText: 'OP ID 108: 5 unidades conformes, 0 no conformes, ubicación C2 y no repuse material' });
    const corrected = await advanceCloseGuide({ ...base, rawText: phrase,
      params: { avance_materiales: { correccion_lote: { ubicacion: 'C3' } } } });
    assert.equal(corrected.draft.location, 'C3', phrase);
    assert.match(corrected.message, /Ubicación del conforme: C3/u);
    assert.equal(corrected.params, undefined);
  }
});

test('una corrección de ubicación incomprensible informa que conservó la anterior', async () => {
  const db = fakeDb({ orderId: 108, planned: 5 });
  const base = { db, userId: 7 };
  await advanceCloseGuide({ ...base,
    rawText: 'OP ID 108: 5 unidades conformes, 0 no conformes, ubicación C2 y no repuse material' });
  const reply = await advanceCloseGuide({ ...base, rawText: 'corrección la ubicación es allá' });
  assert.match(reply.message, /El borrador conserva C2/u);
  assert.equal(reply.draft.location, 'C2');
  assert.equal(reply.params, undefined);
});

test('an operator can begin a close using the sole notified OP without repeating its ID', async () => {
  const db = fakeDb();
  const result = await advanceCloseGuide({ db, userId: 21, from: '573001234567',
    rawText: 'cerramos producción' });
  assert.match(result.message, /OP ID 97/u);
  assert.equal(result.draft.orderId, 97);
  assert.equal(result.params, undefined);
});

test('«se dañaron 2 tapas por ruptura» conserva el cierre y pregunta por su reposición', async () => {
  const db = fakeDb({ orderId: 101, planned: 3, initialDraft: {
    orderId: 101, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'se dañaron 2 tapas por ruptura' });
  assert.equal(result.draft.orderId, 101);
  assert.equal(result.draft.materialPending.sku, '00001-TPBI');
  assert.equal(result.draft.materialPending.cantidad, 2);
  assert.equal(result.draft.materialPending.motivo, 'ruptura');
  assert.match(result.message, /¿Repusiste 2 und de TAPA/u);
  assert.equal(result.params, undefined);
});

test('el lote de un liner dañado no se mezcla con el nombre ni se supone que fue repuesto', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Se dañaron dos liners del lote 1234.' });
  assert.equal(result.draft.materialPending.sku, '00035-LNTP60');
  assert.equal(result.draft.materialPending.cantidad, 2);
  assert.equal(result.draft.materialPending.lote, null);
  assert.equal(result.draft.materialPending.replacementDecision, null);
  assert.match(result.message, /¿Repusiste 2 und de LINER/u);
  assert.deepEqual(db.aliasTerms, ['liners']);
});

test('la reposición narrada junto al daño separa el liner y valida su lote antes del cierre', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, invalidLots: ['1234'], initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Se dañaron dos liners y fueron repuestos del lote 1234' });
  assert.equal(result.draft.materialPending.sku, '00035-LNTP60');
  assert.equal(result.draft.materialPending.replacementDecision, true);
  assert.equal(result.draft.materialPending.lote, null);
  assert.equal(result.draft.materialPending.loteIntentado, '1234');
  assert.match(result.message, /lote \*1234\* no está registrado/u);
  assert.match(result.message, /Lotes disponibles para LINER/u);
  assert.deepEqual(db.aliasTerms, ['liners']);
});

test('una causa seguida de reposición conserva ambos datos del liner', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Se dañaron dos liners por ruptura y fueron repuestos del lote R2-LINER' });
  assert.equal(result.draft.materialPending, null);
  assert.equal(result.draft.materials[0].sku, '00035-LNTP60');
  assert.equal(result.draft.materials[0].motivo, 'ruptura');
  assert.equal(result.draft.materials[0].lote, 'R2-LINER');
  assert.match(result.message, /confirmo cierre/u);
});

test('el lote «es el 1234» no se interpreta como «es» y la causa excluye el lote', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, invalidLots: ['1234'], initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: { sku: '00035-LNTP60', producto: 'LINER TARRO x 60',
      unidad: 'und', cantidad: 2, lote: null, motivo: null, ubicacion: null },
    reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'La causa fue por ruptura y el lote es el 1234.' });
  assert.equal(result.draft.materials[0].motivo, 'ruptura');
  assert.equal(result.draft.materials[0].loteIntentado, '1234');
  assert.match(result.message, /lote \*1234\* no está registrado/u);
});

test('una corrección breve de causa y lote repara la partida de liner en curso', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [{
      sku: '00035-LNTP60', producto: 'LINER TARRO x 60', unidad: 'und', cantidad: 2,
      lote: null, loteIntentado: 'es', motivo: 'fue por ruptura y el lote es el 1234.', ubicacion: null,
    }], materialsAnswered: false, materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const lot = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Salieron del lote R5-260923-Liner' });
  assert.equal(lot.draft.materials[0].lote, 'R5-260923-LINER');
  const reason = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Corrección, la causa fue ruptura.',
    params: { avance_materiales: { items: [{ motivo: 'ruptura' }] } } });
  assert.equal(reason.draft.materials[0].motivo, 'ruptura');
  assert.equal(reason.draft.materials[0].lote, 'R5-260923-LINER');
  assert.match(reason.message, /confirmo cierre/u);
});

test('«Corrección, el lote es ...» acepta el identificador existente sin exigir SKU', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [{
      sku: '00035-LNTP60', producto: 'LINER TARRO x 60', unidad: 'und', cantidad: 2,
      lote: null, loteIntentado: '1234', motivo: 'ruptura', ubicacion: null,
    }], materialsAnswered: false, materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Corrección, el lote es R5-260923-Liner' });
  assert.equal(result.draft.materials[0].lote, 'R5-260923-LINER');
  assert.equal(result.draft.materials[0].motivo, 'ruptura');
  assert.match(result.message, /confirmo cierre/u);
});

test('«Corrección, el lote fue ...» no interpreta «fue» como identificador', async () => {
  const db = fakeDb({ orderId: 102, planned: 3, initialDraft: {
    orderId: 102, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [{
      sku: '00035-LNTP60', producto: 'LINER TARRO x 60', unidad: 'und', cantidad: 2,
      lote: null, loteIntentado: 'fue', motivo: 'ruptura', ubicacion: null,
    }], materialsAnswered: false, materialPending: null, reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Corrección, el lote fue R5-260923-Liner' });
  assert.equal(result.draft.materials[0].lote, 'R5-260923-LINER');
  assert.equal(result.draft.materials[0].motivo, 'ruptura');
  assert.match(result.message, /confirmo cierre/u);
});

test('el audio sin cantidades no puede convertirse en cierre por los parámetros del modelo', async () => {
  const db = fakeDb();
  const result = await advanceCloseGuide({ db, userId: 9,
    rawText: 'Cerramos producción OPIV 97',
    params: { id_orden: 97, cantidad_real: 2, merma: 0, ubicacion: 'C2' } });
  assert.equal(result.params, undefined);
  assert.match(result.message, /Aún no hay datos del cierre/u);
  assert.match(result.message, /Falta:.*cantidad conforme, cantidad no conforme de producto terminado/u);
  assert.match(result.message, /¿Cuántas unidades de producto terminado salieron conformes/iu);
  assert.match(result.message, /responder paso a paso o dar juntos conformes, no conformes/u);
});

test('conserva el OP ID propuesto ante una transcripción OCID y acepta sí sin repetir el prefijo', async () => {
  const db = fakeDb();
  const base = { db, userId: 11 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'Cerramos producción OCID 97', params: { id_orden: 97 } });
  assert.match(first.message, /¿Te refieres al cierre de \*OP ID 97\*/u);
  assert.equal(first.draft.orderId, null);
  assert.equal(first.draft.candidateOrderId, 97);

  const second = await advanceCloseGuide({ ...base, rawText: 'Sí' });
  assert.match(second.message, /¿Cuántas unidades de producto terminado salieron conformes/iu);
  assert.equal(second.draft.orderId, 97);
  assert.equal(second.params, undefined);
});

test('mantiene el candidato cuando el operario aclara el número y luego responde sí', async () => {
  const db = fakeDb();
  const base = { db, userId: 12 };
  await advanceCloseGuide({ ...base, rawText: 'Cerramos producción' });
  const candidate = await advanceCloseGuide({ ...base, rawText: 'El 97' });
  assert.match(candidate.message, /OP ID 97/u);
  assert.equal(candidate.draft.candidateOrderId, 97);
  assert.equal(isCloseFollowup('El 97', candidate.draft), true);
  const confirmedCandidate = await advanceCloseGuide({ ...base, rawText: 'sí' });
  assert.match(confirmedCandidate.message, /¿Cuántas unidades de producto terminado salieron conformes/iu);
  assert.equal(confirmedCandidate.draft.orderId, 97);
  assert.equal(confirmedCandidate.params, undefined);
});

test('una merma genérica queda sin clasificar hasta que el operario precise el tipo', async () => {
  assert.deepEqual(closeFields('quedó una unidad conforme y una merma por destrucción'), {
    conforming: 1, waste: 1, reason: 'destruccion', location: null,
  });
  const db = fakeDb();
  const base = { db, userId: 13 };
  await advanceCloseGuide({ ...base, rawText: 'cerrar OP ID 97' });
  const result = await advanceCloseGuide({ ...base,
    rawText: 'quedó una unidad conforme y una merma por destrucción' });
  assert.match(result.message, /Conformes: 1 und/u);
  assert.equal(result.draft.waste, null);
  assert.deepEqual(result.draft.unclassifiedWaste, { quantity: 1, cause: 'destruccion' });
  assert.match(result.message, /¿Fue \*producto terminado\* o un \*insumo\*/u);
  assert.equal(result.params, undefined);
  const classified = await advanceCloseGuide({ ...base, rawText: 'sí, producto terminado' });
  assert.equal(classified.draft.waste, 1);
  assert.equal(classified.draft.reason, 'destruccion');
  assert.match(classified.message, /Ubicación sugerida para el producto terminado conforme: \*C2\*/u);
});

test('audio ambiguo de OP 100 y merma posterior de tapas conservan el mismo cierre sin descontar inventario', async () => {
  const db = fakeDb({ orderId: 100, planned: 5 });
  const base = { db, userId: 100 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'cerramos op y de 100 con cuatro tarros conformes y una merma',
    params: { id_orden: 100, cantidad_real: 4, merma: 1 } });
  assert.equal(first.draft.orderId, 100);
  assert.equal(first.draft.conforming, null);
  assert.equal(first.draft.waste, null);
  assert.equal(first.draft.unclassifiedWaste.quantity, 1);
  assert.match(first.message, /¿Fue \*producto terminado\* o un \*insumo\*/u);
  assert.equal(first.params, undefined);

  const second = await advanceCloseGuide({ ...base,
    rawText: 'hubo merma de dos tapas por destrucción',
    params: { avance_materiales: { items: [{ producto: 'tapas', cantidad: 2, motivo: 'destrucción' }] } } });
  assert.equal(second.draft.waste, null, 'el daño de tapas no clasifica la merma genérica como producto terminado');
  assert.equal(second.draft.unclassifiedWaste.quantity, 1);
  assert.equal(second.draft.materialPending.cantidad, 2);
  assert.equal(second.draft.materialPending.sku, '00001-TPBI');
  assert.equal(second.draft.materialPending.motivo, 'destruccion');
  assert.match(second.message, /¿Repusiste 2 und de TAPA/u);
  assert.equal(second.params, undefined);
  const affirmed = await advanceCloseGuide({ ...base, rawText: 'sí' });
  assert.match(affirmed.message, /Lotes disponibles para TAPA/u);
  const lot = await advanceCloseGuide({ ...base, rawText: 'lote ACC-260910-TPBI' });
  assert.equal(lot.draft.materials[0].cantidad, 2);
  assert.equal(lot.draft.materials[0].lote, 'ACC-260910-TPBI');
  assert.equal(lot.draft.waste, null);
  const conforming = await advanceCloseGuide({ ...base, rawText: '4 conformes' });
  assert.equal(conforming.draft.conforming, 4);
  const classified = await advanceCloseGuide({ ...base, rawText: 'merma de producto terminado por rotura' });
  assert.equal(classified.draft.waste, 1);
  assert.equal(classified.draft.reason, 'rotura');
  const review = await advanceCloseGuide({ ...base, rawText: 'ubicación C2' });
  assert.match(review.message, /confirmo cierre/u);
  const confirmation = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 100' });
  assert.equal(confirmation.params.cantidad_real, 4);
  assert.equal(confirmation.params.merma, 1);
  assert.deepEqual(confirmation.params.materiales_repuestos, [{
    sku: '00001-TPBI', cantidad: 2, lote: 'ACC-260910-TPBI',
    motivo: 'destruccion', ubicacion: undefined,
  }]);
  assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
});

test('un borrador anterior con merma positiva exige reclasificación antes de confirmar', async () => {
  const db = fakeDb({ orderId: 100, planned: 5, initialDraft: {
    orderId: 100, conforming: 4, waste: 1, reason: 'rotura', location: 'C2',
    materials: [], materialsAnswered: true, materialPending: null,
    reviewShown: true, candidateOrderId: null,
  } });
  const base = { db, userId: 100 };
  const blocked = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
  assert.equal(blocked.params, undefined);
  assert.equal(blocked.draft.waste, null);
  assert.deepEqual(blocked.draft.unclassifiedWaste, { quantity: 1, cause: 'rotura' });
  assert.match(blocked.message, /Merma sin clasificar:.*1 und/u);
  const material = await advanceCloseGuide({ ...base, rawText: 'fue de las tapas' });
  assert.equal(material.draft.unclassifiedWaste, null);
  assert.equal(material.draft.waste, null);
  assert.equal(material.draft.materialPending.sku, '00001-TPBI');
  assert.equal(material.draft.materialPending.cantidad, null);
  assert.match(material.message, /¿Cuántas und de TAPA/u);
  const corrected = await advanceCloseGuide({ ...base, rawText: '2 tapas' });
  assert.equal(corrected.draft.materialPending.cantidad, 2);
  assert.match(corrected.message, /¿Repusiste 2 und de TAPA/u);
});

test('la corrección completa en un audio toma cantidad, alias y causa sin volver a pedir la OP', async () => {
  const db = fakeDb({ orderId: 100, planned: 5, initialDraft: {
    orderId: 100, conforming: null, waste: 1, reason: null, location: null,
    materials: [], materialsAnswered: false, materialPending: null,
    reviewShown: false, candidateOrderId: null,
  } });
  const result = await advanceCloseGuide({ db, userId: 101,
    rawText: 'corrección: fueron 2 tapas dañadas por ruptura' });
  assert.equal(result.draft.orderId, 100);
  assert.equal(result.draft.waste, null);
  assert.equal(result.draft.unclassifiedWaste, null);
  assert.equal(result.draft.materialPending.cantidad, 2);
  assert.equal(result.draft.materialPending.sku, '00001-TPBI');
  assert.equal(result.draft.materialPending.motivo, 'ruptura');
  assert.match(result.message, /¿Repusiste 2 und de TAPA/u);
  assert.equal(result.params, undefined);
});

test('sí y lote de reposición en una sola frase completan el insumo pendiente', async () => {
  const db = fakeDb({ orderId: 100, planned: 5, initialDraft: {
    orderId: 100, conforming: null, waste: null, reason: null, location: null,
    materials: [], materialsAnswered: false, reviewShown: false,
    materialPending: { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 2, motivo: 'destruccion', lote: null, ubicacion: null,
      damageReport: true, replacementDecision: null },
  } });
  const answer = await advanceCloseGuide({ db, userId: 102,
    rawText: 'Sí, fueron sacadas del lote ACC-260910-TPBI' });
  assert.equal(answer.params, undefined);
  assert.equal(answer.draft.materialPending, null);
  assert.equal(answer.draft.materialsAnswered, true);
  const { validatedLotKey, ...material } = answer.draft.materials[0];
  assert.equal(validatedLotKey, '00001-TPBI|2|ACC-260910-TPBI|');
  assert.deepEqual(material, {
    sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
    unidad: 'und', cantidad: 2, motivo: 'destruccion',
    lote: 'ACC-260910-TPBI', ubicacion: null,
  });
  assert.match(answer.message, /Insumo repuesto: 2 und/u);
  assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
});

test('un lote inexistente se rechaza al informarlo, antes de confirmar el cierre', async () => {
  const db = fakeDb({ orderId: 101, planned: 3, invalidLots: ['123456'], initialDraft: {
    orderId: 101, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    reviewShown: false, materialPending: { sku: '00001-TPBI',
      producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und', cantidad: 2,
      motivo: 'ruptura', lote: null, ubicacion: null,
      damageReport: true, replacementDecision: null },
  } });
  const invalid = await advanceCloseGuide({ db, userId: 102,
    rawText: 'Sí, salieron del lote 123456' });
  assert.match(invalid.message, /El lote \*123456\* no está registrado para \*00001-TPBI\*/u);
  assert.equal(invalid.draft.materials[0].lote, null);
  assert.equal(invalid.draft.reviewShown, false);
  const premature = await advanceCloseGuide({ db, userId: 102, rawText: 'confirmo cierre' });
  assert.equal(premature.params, undefined);
  assert.match(premature.message, /lote válido del material repuesto/u);
});

test('una corrección a lote inválido pausa el cierre hasta recibir uno válido', async () => {
  const db = fakeDb({ orderId: 101, planned: 3, invalidLots: ['123456'], initialDraft: {
    orderId: 101, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materialsAnswered: true, reviewShown: true,
    materialPending: null, materials: [{ sku: '00001-TPBI',
      producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und', cantidad: 2,
      lote: 'R4-260921-TPBI', motivo: 'ruptura', ubicacion: null }],
  } });
  const invalid = await advanceCloseGuide({ db, userId: 103,
    rawText: 'corrección, las 2 tapas salieron del lote 123456' });
  assert.match(invalid.message, /El lote \*123456\* no está registrado para \*00001-TPBI\*/u);
  assert.equal(invalid.draft.materials[0].lote, null);
  assert.equal(invalid.draft.materials[0].loteAnterior, 'R4-260921-TPBI');
  assert.equal(invalid.draft.reviewShown, false);
  const blocked = await advanceCloseGuide({ db, userId: 103, rawText: 'confirmo cierre' });
  assert.equal(blocked.params, undefined);
  const corrected = await advanceCloseGuide({ db, userId: 103,
    rawText: 'corrección, las 2 tapas salieron del lote R4-260921-TPBI' });
  assert.equal(corrected.draft.materials[0].lote, 'R4-260921-TPBI');
  assert.equal(corrected.draft.materials[0].loteAnterior, undefined);
  assert.match(corrected.message, /Resumen para confirmar/u);
});

test('un borrador anterior con lote inválido tampoco puede cerrarse tras el despliegue', async () => {
  const db = fakeDb({ orderId: 101, planned: 3, invalidLots: ['123456'], initialDraft: {
    orderId: 101, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materialsAnswered: true, reviewShown: true,
    materialPending: null, materials: [{ sku: '00001-TPBI',
      producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und', cantidad: 2,
      lote: '123456', motivo: 'ruptura', ubicacion: null }],
  } });
  const result = await advanceCloseGuide({ db, userId: 105, rawText: 'confirmo cierre' });
  assert.equal(result.params, undefined);
  assert.equal(result.draft.materials[0].lote, null);
  assert.match(result.message, /El lote \*123456\* no está registrado/u);
  assert.equal(result.draft.reviewShown, false);
});

test('un lote existente sin saldo suficiente se rechaza en el borrador', async () => {
  const db = fakeDb({ orderId: 101, planned: 3, stockAvailable: 1, initialDraft: {
    orderId: 101, conforming: 3, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materialsAnswered: true, reviewShown: false,
    materialPending: null, materials: [{ sku: '00001-TPBI',
      producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und', cantidad: 2,
      lote: 'R4-260921-TPBI', motivo: 'ruptura', ubicacion: null }],
  } });
  const result = await advanceCloseGuide({ db, userId: 104, rawText: 'revisa el cierre' });
  assert.match(result.message, /Saldo insuficiente de \*00001-TPBI\*/u);
  assert.equal(result.draft.materials[0].lote, null);
  assert.equal(result.draft.reviewShown, false);
});

test('la interpretación de IA ayuda con una frase libre pero no puede inventar el lote', async () => {
  const pending = { orderId: 100, conforming: null, waste: null, reason: null,
    location: null, materials: [], materialsAnswered: false, reviewShown: false,
    materialPending: { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 2, motivo: 'destruccion', lote: null,
      ubicacion: null, damageReport: true, replacementDecision: null } };
  const db = fakeDb({ orderId: 100, planned: 5, initialDraft: structuredClone(pending) });
  const result = await advanceCloseGuide({ db, userId: 103,
    rawText: 'Claro, las tomé de la partida ACC 260910 TPBI',
    params: { avance_materiales: { confirmacion_reposicion: true,
      lote_reposicion: 'ACC-260910-TPBI' } } });
  assert.equal(result.draft.materialPending, null);
  assert.equal(result.draft.materials[0].lote, 'ACC-260910-TPBI');

  const unsafeDb = fakeDb({ orderId: 100, planned: 5, initialDraft: structuredClone(pending) });
  const unsafe = await advanceCloseGuide({ db: unsafeDb, userId: 104,
    rawText: 'Claro, las tomé de la partida ACC 260910 TPBI',
    params: { avance_materiales: { confirmacion_reposicion: true,
      lote_reposicion: 'OTRO-LOTE' } } });
  assert.equal(unsafe.draft.materialPending.lote, null);
  assert.equal(unsafe.draft.materialPending.replacementDecision, null);
  assert.equal(unsafe.draft.materials.length, 0);
});

test('material repuesto se reúne por partes, exige lote y causa y solo sale en confirmación final', async () => {
  const db = fakeDb();
  const base = { db, userId: 14 };
  await advanceCloseGuide({ ...base, rawText: 'cerrar OP ID 97' });
  await advanceCloseGuide({ ...base, rawText: '2 conformes, 0 merma, ubicación C2' });
  const product = await advanceCloseGuide({ ...base, rawText: 'repuse una tapa' });
  assert.match(product.message, /Lote: pendiente/u);
  assert.match(product.message, /Causa: pendiente/u);
  const lot = await advanceCloseGuide({ ...base, rawText: 'lote ACC-260910-TPBI' });
  assert.match(lot.message, /Lote: ACC-260910-TPBI/u);
  const reason = await advanceCloseGuide({ ...base, rawText: 'por ruptura' });
  assert.match(reason.message, /Causa: ruptura/u);
  assert.match(reason.message, /confirmo cierre/u);
  assert.equal(reason.params, undefined);
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 97' });
  assert.deepEqual(done.params.materiales_repuestos, [{
    sku: '00001-TPBI', cantidad: 1, lote: 'ACC-260910-TPBI',
    motivo: 'ruptura', ubicacion: undefined,
  }]);
});

test('un solo audio puede cerrar el resultado y declarar dos materiales sin duplicar el OP ID', async () => {
  const db = fakeDb();
  const base = { db, userId: 15 };
  await advanceCloseGuide({ ...base, rawText: 'cerrar OP ID 97' });
  const review = await advanceCloseGuide({ ...base,
    rawText: '2 conformes, 0 merma, ubicación C2; repuse una tapa del lote L-TPBI por ruptura y una etiqueta del lote L-ET por defecto',
  });
  assert.equal(review.params, undefined);
  assert.deepEqual(db.aliasTerms, ['tapa', 'etiqueta']);
  assert.match(review.message, /00001-TPBI/u);
  assert.match(review.message, /00017-ETASH60/u);
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 97' });
  assert.equal(done.params.materiales_repuestos.length, 2);
  assert.equal(done.params.materiales_repuestos[0].motivo, 'ruptura');
  assert.equal(done.params.materiales_repuestos[1].lote, 'L-ET');
});

test('si solo dice que repuso material, pregunta producto y conserva la OP', async () => {
  const db = fakeDb();
  const base = { db, userId: 16 };
  await advanceCloseGuide({ ...base, rawText: 'cerrar OP ID 97' });
  await advanceCloseGuide({ ...base, rawText: '2 conformes, 0 merma, ubicación C2' });
  const partial = await advanceCloseGuide({ ...base, rawText: 'sí repuse materiales' });
  assert.match(partial.message, /¿Qué producto o alias repusiste/u);
  assert.equal(partial.draft.orderId, 97);
  const selected = await advanceCloseGuide({ ...base, rawText: 'tapa' });
  assert.match(selected.message, /00001-TPBI/u);
  assert.match(selected.message, /¿Cuánto/u);
});

test('corrige lote y cantidad dentro del borrador antes de confirmar', async () => {
  const db = fakeDb();
  const base = { db, userId: 17 };
  await advanceCloseGuide({ ...base, rawText: 'cerrar OP ID 97' });
  await advanceCloseGuide({ ...base,
    rawText: '2 conformes, 0 merma, ubicación C2; repuse una tapa lote L-VIEJO por ruptura',
  });
  const correctedLot = await advanceCloseGuide({ ...base, rawText: 'corrige lote de tapa a L-NUEVO' });
  assert.match(correctedLot.message, /L-NUEVO/u);
  assert.doesNotMatch(correctedLot.message, /L-VIEJO/u);
  const correctedQuantity = await advanceCloseGuide({ ...base, rawText: 'corrige cantidad de tapa a 2' });
  assert.match(correctedQuantity.message, /00001-TPBI\): 2 und/u);
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 97' });
  assert.equal(done.params.materiales_repuestos[0].lote, 'L-NUEVO');
  assert.equal(done.params.materiales_repuestos[0].cantidad, 2);
});

test('corrige el lote con la frase natural y su transcripción imperfecta sin cerrar la OP', async () => {
  for (const phrase of ['corrección, las 2 tapas salieron de R2-260920-TPBI',
    'correción, las 2 tapas salieron de R2-260920-TPBI']) {
    const db = fakeDb({ orderId: 100, planned: 5, initialDraft: {
      orderId: 100, conforming: 5, waste: 0, reason: null, location: 'C2',
      materials: [{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
        cantidad: 2, unidad: 'und', lote: 'ACC-260910-TPBI', motivo: 'destruccion' }],
      materialsAnswered: true, materialPending: null, reviewShown: true,
    } });
    assert.equal(isCloseFollowup(phrase, { orderId: 100 }), true);
    const corrected = await advanceCloseGuide({ db, userId: 105, rawText: phrase });
    assert.equal(corrected.params, undefined);
    assert.match(corrected.message, /Lote de reposición: R2-260920-TPBI/u);
    assert.doesNotMatch(corrected.message, /ACC-260910-TPBI/u);
    assert.equal(corrected.draft.materials[0].lote, 'R2-260920-TPBI');
    assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
    const final = await advanceCloseGuide({ db, userId: 105, rawText: 'confirmo cierre OP ID 100' });
    assert.equal(final.params.materiales_repuestos[0].lote, 'R2-260920-TPBI');
  }
});

test('la IA no puede cambiar a un lote que el operario no mencionó', async () => {
  const db = fakeDb({ orderId: 100, planned: 5, initialDraft: {
    orderId: 100, conforming: 5, waste: 0, reason: null, location: 'C2',
    materials: [{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      cantidad: 2, unidad: 'und', lote: 'ACC-260910-TPBI', motivo: 'destruccion' }],
    materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  const result = await advanceCloseGuide({ db, userId: 106,
    rawText: 'corrección: las tapas eran de otra partida',
    params: { avance_materiales: { correccion_lote: {
      producto: 'tapas', lote: 'R2-260920-TPBI', cantidad: 2,
    } } } });
  assert.equal(result.draft.materials[0].lote, 'ACC-260910-TPBI');
  assert.equal(result.params, undefined);
});

test('la IA interpreta una corrección libre del lote sin inventar otro material', async () => {
  const db = fakeDb({ orderId: 100, planned: 5, initialDraft: {
    orderId: 100, conforming: 5, waste: 0, reason: null, location: 'C2',
    materials: [{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      cantidad: 2, unidad: 'und', lote: 'ACC-260910-TPBI', motivo: 'destruccion' }],
    materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  const corrected = await advanceCloseGuide({ db, userId: 107,
    rawText: 'Perdón, la partida correcta es R2-260920-TPBI',
    params: { avance_materiales: { correccion_lote: {
      producto: 'tapas', lote: 'R2-260920-TPBI',
    } } } });
  assert.equal(corrected.draft.materials[0].lote, 'R2-260920-TPBI');
  assert.match(corrected.message, /confirmo cierre/u);
  assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
});

test('parsea cantidades y causas expresas sin tomar el OP ID como unidades', () => {
  assert.equal(closeOrderReference('Cerramos producción OPIV 97', { id_orden: 97 }), 97);
  assert.equal(hasProductionCloseIntent('Cerramos OPIV97'), true);
  assert.throws(() => closeOrderReference('Cerrar OPIV 97 y OPIV 95', {}), /más de una OP/u);
  assert.deepEqual(closeFields('Cerramos producción OPIV 97'), {
    conforming: null, waste: null, reason: null, location: null,
  });
  assert.deepEqual(closeFields('cerramos OP ID 57 con 47 conformes, 3 mermas por daño en etiquetas, dejar en PPAL-A-1-01'), {
    conforming: 47, waste: 3, reason: 'dano en etiquetas', location: 'PPAL-A-1-01',
  });
  assert.deepEqual(closeFields('1 producto terminado conforme, 1 producto terminado no conforme por ruptura'), {
    conforming: 1, waste: 1, reason: 'ruptura', location: null,
  });
  assert.equal(confirmed('sí'), false);
  assert.equal(confirmed('confirmo cierre'), false);
  assert.equal(confirmed('confirmo cierre OP ID 97'), true);
  assert.equal(isCloseFollowup('C2', { orderId: 97 }), true);
  assert.equal(isCloseFollowup('cuánto stock queda', { orderId: 97 }), false);
});

test('OP 109 permite escoger el lote repuesto por número y revisar todo antes de cerrar', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sellado defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const base = { db, userId: 7 };
  const options = await advanceCloseGuide({ ...base, rawText: 'repuse 1 liner por ruptura' });
  assert.match(options.message, /Lotes disponibles para LINER/u);
  assert.match(options.message, /1\. Lote \*R5-260923-LINER\* \| ubicación \*A14\*/u);
  assert.match(options.message, /No necesitas escribir ni deletrear el lote/u);
  assert.equal(options.params, undefined);
  assert.equal(isCloseFollowup('opción 1', options.draft), true);

  const review = await advanceCloseGuide({ ...base, rawText: 'opción uno' });
  assert.match(review.message, /Resumen para confirmar/u);
  assert.match(review.message, /Producto terminado no conforme: 1 und \| Causa: sellado defectuoso/u);
  assert.match(review.message, /Lote de reposición: R5-260923-LINER \| Causa: ruptura \| Ubicación: A14/u);
  assert.match(review.message, /1 conforme\(s\) \+ 1 no conforme\(s\) = 2 und frente a 2 planeadas/u);
  assert.equal(review.params, undefined);

  const confirmedClose = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.deepEqual(confirmedClose.params.materiales_repuestos, [{
    sku: '00035-LNTP60', cantidad: 1, lote: 'R5-260923-LINER',
    motivo: 'ruptura', ubicacion: 'A14',
  }]);
  assert.equal(confirmedClose.params.merma, 1);
  assert.equal(confirmedClose.params.motivo_merma, 'sellado defectuoso');
  assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
});

test('un lote elegido se revalida y no permite confirmar si desapareció el saldo', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sellado defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const base = { db, userId: 7 };
  await advanceCloseGuide({ ...base, rawText: 'repuse 1 liner por ruptura' });
  db.setFreeStock(0);
  const stale = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.match(stale.message, /opción ya no está disponible/u);
  assert.equal(stale.params, undefined);
  const attempted = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.equal(attempted.params, undefined);
});

test('si el saldo cambia después de escoger lote, la confirmación vuelve al borrador', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 2, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const base = { db, userId: 7 };
  await advanceCloseGuide({ ...base, rawText: 'repuse 1 liner por ruptura' });
  const reviewed = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.match(reviewed.message, /Resumen para confirmar/u);
  db.setFreeStock(0);
  const blocked = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.equal(blocked.params, undefined);
  assert.match(blocked.message, /Saldo insuficiente/u);
  assert.match(blocked.message, /cierre en borrador/u);
});

test('el resumen permite volver a escoger el lote sin dictar el nuevo código', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, replacementOptions: [
    { lote: 'L-UNO', ubicacion: 'A14', disponible: 4, vence: '2027-09-30' },
    { lote: 'L-DOS', ubicacion: 'A14', disponible: 5, vence: '2028-06-30' },
  ], initialDraft: {
    orderId: 109, conforming: 2, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [{ sku: '00035-LNTP60',
      producto: 'LINER TARRO x 60', unidad: 'und', cantidad: 1,
      lote: 'L-UNO', motivo: 'ruptura', ubicacion: 'A14' }],
    materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  const base = { db, userId: 7 };
  const options = await advanceCloseGuide({ ...base, rawText: 'quiero cambiar el lote' });
  assert.match(options.message, /1\. Lote \*L-UNO\*/u);
  assert.match(options.message, /2\. Lote \*L-DOS\*/u);
  assert.equal(options.params, undefined);
  const review = await advanceCloseGuide({ ...base, rawText: 'opción 2' });
  assert.match(review.message, /Lote de reposición: L-DOS/u);
  assert.equal(review.params, undefined);
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.equal(done.params.materiales_repuestos[0].lote, 'L-DOS');
});

test('las opciones de reposición se limitan a la ubicación declarada y permiten paginar', async () => {
  const replacementOptions = Array.from({ length: 9 }, (_, index) => ({
    lote: `L-${index + 1}`, ubicacion: 'A14', disponible: 5,
    vence: `2028-01-${String(index + 1).padStart(2, '0')}`,
  }));
  replacementOptions.push({ lote: 'L-OTRA', ubicacion: 'B14', disponible: 5, vence: '2028-01-15' });
  const db = fakeDb({ orderId: 109, planned: 2, replacementOptions,
    initialDraft: { orderId: 109, conforming: 2, waste: 0, wasteClassified: true,
      reason: null, location: 'C2', materials: [], materialsAnswered: false,
      materialPending: null, reviewShown: false } });
  const base = { db, userId: 7 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'repuse 1 liner ubicación A14 por ruptura' });
  assert.match(first.message, /1\. Lote \*L-1\*/u);
  assert.doesNotMatch(first.message, /L-OTRA/u);
  assert.match(first.message, /más opciones/u);
  const more = await advanceCloseGuide({ ...base, rawText: 'más opciones' });
  assert.match(more.message, /9\. Lote \*L-9\*/u);
  const review = await advanceCloseGuide({ ...base, rawText: 'opción 9' });
  assert.match(review.message, /Lote de reposición: L-9/u);
});

test('una corrección sin lotes aptos bloquea el cierre hasta conservar expresamente el anterior', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, replacementOptions: [], initialDraft: {
    orderId: 109, conforming: 2, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [{ sku: '00035-LNTP60',
      producto: 'LINER TARRO x 60', unidad: 'und', cantidad: 1,
      lote: 'R5-260923-LINER', motivo: 'ruptura', ubicacion: 'A14' }],
    materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  const base = { db, userId: 7 };
  const blocked = await advanceCloseGuide({ ...base, rawText: 'quiero cambiar el lote' });
  assert.match(blocked.message, /No hay lotes/u);
  const premature = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.equal(premature.params, undefined);
  assert.match(premature.message, /elegir el lote/u);
  const retained = await advanceCloseGuide({ ...base, rawText: 'conservar lote anterior' });
  assert.match(retained.message, /Resumen para confirmar/u);
  assert.equal(retained.params, undefined);
});

test('si ningún lote cubre la cantidad, el operario puede corregirla y volver a ver opciones', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, replacementOptions: [
    { lote: 'L-DOS', ubicacion: 'A14', disponible: 2, vence: '2028-06-30' },
  ], initialDraft: {
    orderId: 109, conforming: 2, waste: 0, wasteClassified: true,
    reason: null, location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const base = { db, userId: 7 };
  const unavailable = await advanceCloseGuide({ ...base, rawText: 'repuse 3 liner por ruptura' });
  assert.match(unavailable.message, /No hay lotes/u);
  const corrected = await advanceCloseGuide({ ...base, rawText: 'corrige cantidad a 1' });
  assert.match(corrected.message, /1\. Lote \*L-DOS\*/u);
  assert.equal(corrected.draft.materialPending.cantidad, 1);
});
