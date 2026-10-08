const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceCloseGuide, closeFields, closeOrderReference, confirmed, isCloseFollowup,
} = require('../api/_lib/production-close-guide');
const { hasProductionCloseIntent } = require('../api/_lib/production-close-input');

function fakeDb({ orderId = 97, planned = 2, initialDraft = null,
  invalidLots = [], stockAvailable = 100, replacementOptions = null, withGomas = false,
  stockLocations = {} } = {}) {
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
        ? [] : [{ id: 1, lpn: String(params[0]).toUpperCase(), qty_current: Math.max(freeStock, 100),
          status: 'DISPONIBLE', bodega_id: 1 }]];
      if (sql.includes('FROM stock s JOIN lots l')) return [(replacementOptions || [
        { lote: 'ACC-260910-TPBI', ubicacion: 'A8', disponible: freeStock, vence: '2027-09-30' },
        { lote: 'R5-260923-LINER', ubicacion: 'A14', disponible: freeStock, vence: '2028-06-30' },
        { lote: 'AA-260929-01-ETASH', ubicacion: 'A1', disponible: freeStock, vence: '2028-06-30' },
      ]).filter(row => Number(row.disponible) >= Number(params[1])
        && (replacementOptions || row.ubicacion === (Number(params[0]) === 35 ? 'A14'
          : Number(params[0]) === 17 ? 'A1' : 'A8'))
        && (!params[3] || row.ubicacion === params[3]))];
      if (sql.includes('FROM stock s JOIN ubicaciones u')) return [[{
        id: 1, ubicacion_id: stockLocations[params[1]] === 'A14' ? 14
          : Number(params[0]) === 35 ? 14 : Number(params[0]) === 17 ? 1 : 8,
        cantidad: freeStock, reservada: 0,
        ubicacion: stockLocations[params[1]] || (Number(params[0]) === 35 ? 'A14' : Number(params[0]) === 17 ? 'A1' : 'A8'),
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
      { producto_id: 35, unidad: 'und', sku: '00035-LNTP60', nombre: 'LINER TARRO x 60' },
      ...(withGomas ? [{ producto_id: 50, unidad: 'g', sku: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS' }] : [])]];
      if (sql.includes('FROM productos p') && sql.includes('LEFT JOIN skus')) {
        const products = [
          { id: 6, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO' },
          { id: 17, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA' },
          { id: 35, siigo_code: '00035-LNTP60', nombre: 'LINER TARRO x 60' },
        ];
        const scoped = params.slice(3);
        return [products.filter(item => (!scoped.length || scoped.includes(item.id))
          && (Number(params[0]) === item.id
            || String(params[1]).toUpperCase() === item.siigo_code))];
      }
      if (sql.includes('FROM producto_aliases pa')) { aliasTerms.push(params[0]); return [[/gomas?/u.test(params[0]) && withGomas ? {
        id: 50, siigo_code: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS',
        unit_label: 'g', alias: 'gomas',
      } : /^liners?$/u.test(params[0]) ? {
        id: 35, siigo_code: '00035-LNTP60', nombre: 'LINER TARRO x 60',
        unit_label: 'und', alias: 'liners',
      } : /^etiquetas?$/u.test(params[0]) ? {
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

test('transcripciones inequívocas de OP ID confirman solo la orden revisada', async () => {
  const variants = ['Confirmo cierre OPIB 115', 'confirmo cierre OPIV 115',
    'confirmo cierre OPI 115', 'confirmo cierre OP 115', 'confirmo cierre OP y de 115'];
  for (const phrase of variants) {
    const db = fakeDb({ orderId: 115, planned: 5 });
    const base = { db, userId: 7 };
    const preview = await advanceCloseGuide({ ...base,
      rawText: 'Cerrar OP ID 115: 5 conformes, 0 no conformes, ubicación C2, no repuse material' });
    assert.equal(closeOrderReference(phrase), 115, phrase);
    assert.equal(confirmed(phrase), true, phrase);
    assert.equal(isCloseFollowup(phrase, preview.draft), true, phrase);
    const result = await advanceCloseGuide({ ...base, rawText: phrase,
      params: { id_orden: 115 } });
    assert.equal(result.params.id_orden, 115, phrase);
  }
});

test('OPIB no autoriza cierre sin verbo, con otro número o con referencia inventada', async () => {
  const db = fakeDb({ orderId: 115, planned: 5 });
  const base = { db, userId: 7 };
  await advanceCloseGuide({ ...base,
    rawText: 'Cerrar OP ID 115: 5 conformes, 0 no conformes, ubicación C2, no repuse material' });
  for (const phrase of ['confirmo cierre OPIB', 'OPIB 115', 'confirmo cierre OPIB 116']) {
    const result = await advanceCloseGuide({ ...base, rawText: phrase });
    assert.equal(result.params, undefined, phrase);
    assert.equal(result.draft.orderId, 115, phrase);
  }
  const inferred = await advanceCloseGuide({ ...base,
    rawText: 'confirmo cierre', params: { id_orden: 115 } });
  assert.equal(inferred.params, undefined);
  const mismatch = await advanceCloseGuide({ ...base,
    rawText: 'confirmo cierre OPIB 115', params: { id_orden: 116 } });
  assert.equal(mismatch.params, undefined);
  assert.match(mismatch.message, /No pude verificar la referencia/u);
  const valid = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OPIB 115' });
  assert.equal(valid.params.id_orden, 115);
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
  assert.match(premature.message, /elige lote/u);
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
  assert.match(product.message, /Lotes disponibles para TAPA/u);
  assert.doesNotMatch(product.message, /Registrado hasta ahora|Resumen para confirmar|Causa: pendiente/u);
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
  assert.match(options.message, /OP ID 109 — elige lote/u);
  assert.doesNotMatch(options.message, /Plan:|Registrado hasta ahora|Resumen para confirmar|Siguiente paso/u);
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

test('OP 109 conserva «un liner» aunque la interpretación omita la cantidad', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sello defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const result = await advanceCloseGuide({ db, userId: 52,
    rawText: 'repuse un liner por ruptura',
    params: { avance_materiales: { items: [{ producto: 'liner', cantidad: null, motivo: 'ruptura' }] } },
  });
  assert.equal(result.draft.materialPending.cantidad, 1);
  assert.equal(result.draft.materialPending.motivo, 'ruptura');
  assert.match(result.message, /Lotes disponibles para LINER/u);
  assert.equal(result.params, undefined);
});

test('OP 109 acepta cifras o palabras al completar el mismo liner sin duplicarlo', async () => {
  for (const reply of ['se repuso 1 unidad de liner', 'se repuso una unidad de liner']) {
    const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
      orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
      reason: 'sello defectuoso', location: 'C2', materials: [], materialsAnswered: false,
      materialPending: { sku: '00035-LNTP60', producto: 'LINER TARRO x 60', unidad: 'und',
        cantidad: null, lote: null, motivo: 'ruptura', ubicacion: null }, reviewShown: false,
    } });
    const result = await advanceCloseGuide({ db, userId: 53, rawText: reply,
      params: { avance_materiales: { items: [{ producto: 'liner', cantidad: null }] } },
    });
    assert.equal(result.draft.materialPending.cantidad, 1);
    assert.equal(result.draft.materials.length, 0);
    assert.match(result.message, /Lotes disponibles para LINER/u);
    assert.equal(result.params, undefined);
  }
});

test('el texto explícito del operario prevalece ante un SKU distinto interpretado por IA', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sello defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const result = await advanceCloseGuide({ db, userId: 55,
    rawText: 'repuse 1 liner por ruptura',
    params: { avance_materiales: { items: [{ producto: 'tapa', cantidad: 9, motivo: 'otro' }] } },
  });
  assert.equal(result.draft.materialPending.sku, '00035-LNTP60');
  assert.equal(result.draft.materialPending.cantidad, 1);
  assert.equal(result.draft.materialPending.motivo, 'ruptura');
});

test('no añade otro SKU mientras el anterior espera cantidad o lote', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sello defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: { sku: '00035-LNTP60', producto: 'LINER TARRO x 60', unidad: 'und',
      cantidad: null, lote: null, motivo: 'ruptura', ubicacion: null }, reviewShown: false,
  } });
  await assert.rejects(
    advanceCloseGuide({ db, userId: 56, rawText: 'repuse 1 tapa por defecto' }),
    /Primero completa LINER TARRO x 60/u
  );
  assert.equal(db.writes.length, 0);
});

test('varios SKU sin lote quedan en cola y se muestran lotes de cada uno antes del cierre', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sello defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const base = { db, userId: 54 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'repuse un liner por ruptura y una tapa por defecto' });
  assert.equal(first.draft.materialPending.sku, '00035-LNTP60');
  assert.equal(first.draft.materialQueue.length, 1);
  assert.equal(first.draft.materialQueue[0].sku, '00001-TPBI');
  assert.match(first.message, /Lotes disponibles para LINER/u);
  assert.doesNotMatch(first.message, /TAPA TARRO CUADRADO BLANCO|Registrado hasta ahora/u);
  const second = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.equal(second.draft.materials.length, 1);
  assert.equal(second.draft.materialPending.sku, '00001-TPBI');
  assert.match(second.message, /Lotes disponibles para TAPA/u);
  const review = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.equal(review.draft.materials.length, 2);
  assert.match(review.message, /Resumen para confirmar/u);
  assert.match(review.message, /00035-LNTP60/u);
  assert.match(review.message, /00001-TPBI/u);
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 109' });
  assert.equal(done.params.materiales_repuestos.length, 2);
  assert.equal(done.params.materiales_repuestos[0].motivo, 'ruptura');
  assert.equal(done.params.materiales_repuestos[1].motivo, 'defecto');
});

test('después del primer resumen se puede añadir otro SKU antes de confirmar', async () => {
  const db = fakeDb({ orderId: 109, planned: 2, initialDraft: {
    orderId: 109, conforming: 1, waste: 1, wasteClassified: true,
    reason: 'sello defectuoso', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: null, reviewShown: false,
  } });
  const base = { db, userId: 57 };
  await advanceCloseGuide({ ...base, rawText: 'repuse un liner por ruptura' });
  const firstReview = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.match(firstReview.message, /Si repusiste otro SKU/u);
  const secondOptions = await advanceCloseGuide({ ...base, rawText: 'repuse una tapa por defecto' });
  assert.match(secondOptions.message, /Lotes disponibles para TAPA/u);
  assert.equal(secondOptions.draft.materials.length, 1);
  const finalReview = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.equal(finalReview.draft.materials.length, 2);
  assert.match(finalReview.message, /Resumen para confirmar/u);
});

test('«cambio de etiquetas» identifica un insumo de la OP y pregunta lo que falta', async () => {
  const db = fakeDb({ orderId: 110, planned: 8, initialDraft: {
    orderId: 110, conforming: 7, waste: 1, wasteClassified: true,
    reason: 'defecto', location: 'C2', materials: [], materialsAnswered: true,
    materialPending: null, reviewShown: true,
  } });
  const started = await advanceCloseGuide({ db, userId: 7, rawText: 'cambio de etiquetas' });
  assert.equal(started.draft.materialPending?.sku, '00017-ETASH60');
  assert.equal(started.draft.materialPending?.cantidad, null);
  assert.match(started.message, /¿Cuánto ETIQUETA ASHWAGANDHA repusiste\?/u);
  assert.equal(isCloseFollowup('cambio de etiquetas', started.draft), true);
  assert.equal(started.draft.reason, 'defecto');
  assert.equal(started.draft.materialChoice == null, true);
});

test('«cambié dos etiquetas» toma la cantidad sin inventar lote ni alterar otra reposición', async () => {
  const db = fakeDb({ orderId: 110, planned: 8, initialDraft: {
    orderId: 110, conforming: 7, waste: 1, wasteClassified: true,
    reason: 'defecto', location: 'C2', materials: [{ sku: '00001-TPBI',
      producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und', cantidad: 1,
      lote: 'ACC-260910-TPBI', motivo: 'ruptura', ubicacion: 'A8' }],
    materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'cambié dos etiquetas por mala impresión' });
  assert.equal(result.draft.materialPending?.sku, '00017-ETASH60');
  assert.equal(result.draft.materialPending?.cantidad, 2);
  assert.equal(result.draft.materialPending?.motivo, 'mala impresion');
  assert.equal(result.draft.materials[0].cantidad, 1);
  assert.match(result.message, /elige lote/u);
});

test('«cambio de etiquetas» no duplica una reposición ya registrada', async () => {
  const db = fakeDb({ orderId: 110, planned: 8, initialDraft: {
    orderId: 110, conforming: 7, waste: 1, wasteClassified: true,
    reason: 'defecto', location: 'C2', materials: [{ sku: '00017-ETASH60',
      producto: 'ETIQUETA ASHWAGANDHA', unidad: 'und', cantidad: 2,
      lote: 'AA-260929-01-ETASH', motivo: 'impresión', ubicacion: 'A1' }],
    materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  await assert.rejects(() => advanceCloseGuide({ db, userId: 7,
    rawText: 'cambio de etiquetas' }), /¿Quieres corregirla o agregar otra reposición\?/u);
  assert.equal(db.writes.length, 0);
});

test('OP 110 acepta una causa breve del insumo sin cambiar la merma del producto terminado', async () => {
  const db = fakeDb({ orderId: 110, planned: 8 });
  const base = { db, userId: 58 };
  await advanceCloseGuide({ ...base, rawText: 'cerramos op id 110' });
  const quantities = await advanceCloseGuide({ ...base,
    rawText: '7 conformes, 1 no conforme, ubicación C2' });
  assert.equal(quantities.draft.waste, 1);
  const ptCause = await advanceCloseGuide({ ...base,
    rawText: 'Motivo de la merma Tapa defectuosa' });
  assert.equal(ptCause.draft.reason, 'tapa defectuosa');
  const lid = await advanceCloseGuide({ ...base, rawText: 'Repuse una tapa' });
  assert.match(lid.message, /elige lote/u);
  const selected = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.equal(selected.draft.materialPending?.sku, '00001-TPBI');
  assert.ok(selected.draft.materialPending?.lote);
  const direct = await advanceCloseGuide({ ...base, rawText: 'rupturaa' });
  assert.equal(direct.draft.reason, 'tapa defectuosa');
  assert.equal(direct.draft.materialPending, null, JSON.stringify(direct.draft));
  assert.equal(direct.draft.materials[0].motivo, 'ruptura');
  assert.match(direct.message, /Resumen para confirmar/u);
  const label = await advanceCloseGuide({ ...base,
    rawText: 'repuse 2 etiquetas y la causa fue mala impresión' });
  assert.match(label.message, /elige lote/u);
  assert.equal(label.draft.materialPending?.motivo, 'mala impresión', JSON.stringify(label.draft));
  const review = await advanceCloseGuide({ ...base, rawText: 'opción 1' });
  assert.equal(review.draft.reason, 'tapa defectuosa');
  assert.equal(review.draft.materials.length, 2, JSON.stringify(review.draft));
  assert.equal(review.draft.materials[0].motivo, 'ruptura');
  assert.equal(review.draft.materials[1].motivo, 'mala impresión');
  assert.match(review.message, /Producto terminado no conforme: 1 und \| Causa: tapa defectuosa/u);
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre OP ID 110' });
  assert.equal(done.params.motivo_merma, 'tapa defectuosa');
  assert.equal(done.params.materiales_repuestos.length, 2);
  assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
});

test('la frase completa de causa de reposición se limpia y no sobrescribe la causa del PT', async () => {
  const db = fakeDb({ orderId: 110, planned: 8, initialDraft: {
    orderId: 110, conforming: 7, waste: 1, wasteClassified: true,
    reason: 'tapa defectuosa', location: 'C2', materials: [], materialsAnswered: false,
    materialPending: { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 1, lote: 'ACC-260910-TPBI', motivo: null,
      ubicacion: 'A8' }, reviewShown: false,
  } });
  const result = await advanceCloseGuide({ db, userId: 59,
    rawText: 'a causa de la reposición fue ruptura' });
  assert.equal(result.draft.reason, 'tapa defectuosa');
  assert.equal(result.draft.materials[0].motivo, 'ruptura');
  assert.match(result.message, /Resumen para confirmar/u);
});

test('la causa de merma del PT se puede corregir sin alterar dos materiales ya revisados', async () => {
  const db = fakeDb({ orderId: 110, planned: 8, initialDraft: {
    orderId: 110, conforming: 7, waste: 1, wasteClassified: true,
    reason: 'de la reposición fue ruptura', location: 'C2', materialsAnswered: true,
    materials: [{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 1, lote: 'ACC-260910-TPBI', motivo: 'de la reposición fue ruptura', ubicacion: 'A8' },
    { sku: '00017-ETASH60', producto: 'ETIQUETA ASHWAGANDHA',
      unidad: 'und', cantidad: 2, lote: 'AA-260929-01-ETASH', motivo: 'fue mala impresión', ubicacion: 'A1' }],
    materialPending: null, reviewShown: true,
  } });
  const base = { db, userId: 60 };
  const correctedPt = await advanceCloseGuide({ ...base,
    rawText: 'corrección: motivo de la merma es tapa defectuosa' });
  assert.equal(correctedPt.draft.reason, 'tapa defectuosa');
  assert.equal(correctedPt.draft.materials.length, 2);
  assert.equal(correctedPt.draft.materials[0].motivo, 'de la reposición fue ruptura');
  const correctedLid = await advanceCloseGuide({ ...base,
    rawText: 'corrige causa de tapa a ruptura' });
  assert.equal(correctedLid.draft.reason, 'tapa defectuosa');
  assert.equal(correctedLid.draft.materials[0].motivo, 'ruptura');
  assert.equal(correctedLid.draft.materials[1].motivo, 'fue mala impresión');
  const corrected = await advanceCloseGuide({ ...base,
    rawText: 'corrige causa de etiqueta a mala impresión' });
  assert.equal(corrected.draft.reason, 'tapa defectuosa');
  assert.equal(corrected.draft.materials.length, 2);
  assert.equal(corrected.draft.materials[0].motivo, 'ruptura');
  assert.equal(corrected.draft.materials[1].motivo, 'mala impresión');
  assert.match(corrected.message, /Producto terminado no conforme: 1 und \| Causa: tapa defectuosa/u);
  assert.equal(corrected.params, undefined);
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
  assert.match(blocked.message, /elige lote/u);
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

test('cambiar lote ofrece otras ubicaciones cuando ambas cubren la reposición', async () => {
  const db = fakeDb({ orderId: 113, planned: 20,
    stockAvailable: 60, stockLocations: { 'LOTE-B11': 'B11', 'LOTE-C5': 'C5' },
    replacementOptions: [
      { lote: 'LOTE-B11', ubicacion: 'B11', disponible: 60 },
      { lote: 'LOTE-C5', ubicacion: 'C5', disponible: 20 },
    ], initialDraft: { orderId: 113, conforming: 19, waste: 1,
      wasteClassified: true, reason: 'defecto', location: 'C7',
      materials: [{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
        unidad: 'und', cantidad: 2, lote: 'LOTE-B11', motivo: 'ruptura', ubicacion: 'B11' }],
      materialsAnswered: true, materialPending: null, reviewShown: true } });
  const base = { db, userId: 7 };
  const options = await advanceCloseGuide({ ...base, rawText: 'cambia lote de partida 1' });
  assert.match(options.message, /Lote \*LOTE-B11\* \| ubicación \*B11\*/u);
  assert.match(options.message, /Lote \*LOTE-C5\* \| ubicación \*C5\*/u);
  assert.equal(options.draft.location, 'C7');
  const chosen = await advanceCloseGuide({ ...base, rawText: 'opción 2' });
  assert.equal(chosen.draft.materials[0].lote, 'LOTE-C5');
  assert.equal(chosen.draft.materials[0].ubicacion, 'C5');
  assert.equal(chosen.draft.location, 'C7');

  const filtered = await advanceCloseGuide({ ...base,
    rawText: 'cambia lote de partida 1 en B11' });
  assert.match(filtered.message, /Lote \*LOTE-B11\*/u);
  assert.doesNotMatch(filtered.message, /Lote \*LOTE-C5\*/u);
  assert.equal(filtered.draft.location, 'C7');
});

test('OP 115 acepta cambiar el lote de etiquetas por nombre o SKU sin pedir partida', async () => {
  const materials = [
    { sku: '00035-LNTP60', producto: 'LINER TARRO x 60', unidad: 'und',
      cantidad: 1, lote: 'R5-260923-LINER', motivo: 'ruptura', ubicacion: 'A14' },
    { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und',
      cantidad: 1, lote: 'ACC-260910-TPBI', motivo: 'mal olor', ubicacion: 'A8' },
    { sku: '00017-ETASH60', producto: 'ETIQUETA ASHWAGANDHA', unidad: 'und',
      cantidad: 1, lote: 'AA-260929-01-ETASH', motivo: 'mala impresión', ubicacion: 'A1' },
  ];
  for (const phrase of ['Cambio de lote en etiquetas',
    'el lote de las etiquetas es otro', 'cambia lote de 00017-ETASH60']) {
    const db = fakeDb({ orderId: 115, planned: 5,
      replacementOptions: [
        { lote: 'AA-260929-01-ETASH', ubicacion: 'A1', disponible: 10 },
        { lote: 'AA-260930-14-ETASH', ubicacion: 'B1', disponible: 10 },
      ], stockLocations: { 'AA-260930-14-ETASH': 'B1' },
      initialDraft: { orderId: 115, conforming: 4, waste: 1, wasteClassified: true,
        reason: 'daño', location: 'C2', materials: structuredClone(materials),
        materialsAnswered: true, materialPending: null, reviewShown: true } });
    const base = { db, userId: 7 };
    assert.equal(isCloseFollowup(phrase, { orderId: 115, materials }), true, phrase);
    const options = await advanceCloseGuide({ ...base, rawText: phrase });
    assert.equal(options.draft.materialChoice.target, 'existing', phrase);
    assert.equal(options.draft.materialChoice.index, 2, phrase);
    assert.match(options.message, /elige lote/u);
    assert.match(options.message, /AA-260930-14-ETASH/u);
    assert.equal(options.draft.materials[2].lote, 'AA-260929-01-ETASH', phrase);
    assert.equal(options.draft.location, 'C2', phrase);
    assert.equal(options.params, undefined, phrase);
    const chosen = await advanceCloseGuide({ ...base, rawText: 'opción 2' });
    assert.equal(chosen.draft.materials[2].lote, 'AA-260930-14-ETASH', phrase);
    assert.equal(chosen.draft.materials[2].ubicacion, 'B1', phrase);
    assert.equal(chosen.draft.materials[0].lote, 'R5-260923-LINER', phrase);
    assert.equal(chosen.draft.materials[1].lote, 'ACC-260910-TPBI', phrase);
    assert.match(chosen.message, /Si un insumo aparece una sola vez/u);
    const materialsBeforeRepeat = structuredClone(chosen.draft.materials);
    assert.equal(isCloseFollowup('opción 2', chosen.draft), true, phrase);
    const repeated = await advanceCloseGuide({ ...base, rawText: 'opción 2' });
    assert.match(repeated.message, /Resumen para confirmar/u);
    assert.deepEqual(repeated.draft.materials, materialsBeforeRepeat);
    assert.equal(repeated.params, undefined);
  }
});

test('cambiar lote por producto exige partida solo cuando ese producto se repuso varias veces', async () => {
  const db = fakeDb({ orderId: 115, planned: 5, initialDraft: {
    orderId: 115, conforming: 4, waste: 1, wasteClassified: true,
    reason: 'daño', location: 'C2', materials: [
      { sku: '00017-ETASH60', producto: 'ETIQUETA ASHWAGANDHA', unidad: 'und',
        cantidad: 1, lote: 'AA-260929-01-ETASH', motivo: 'mala impresión', ubicacion: 'A1' },
      { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und',
        cantidad: 1, lote: 'ACC-260910-TPBI', motivo: 'ruptura', ubicacion: 'A8' },
      { sku: '00017-ETASH60', producto: 'ETIQUETA ASHWAGANDHA', unidad: 'und',
        cantidad: 1, lote: 'AA-260930-14-ETASH', motivo: 'mala impresión', ubicacion: 'A1' },
    ], materialsAnswered: true, materialPending: null, reviewShown: true,
  } });
  const base = { db, userId: 7 };
  await assert.rejects(() => advanceCloseGuide({ ...base,
    rawText: 'Cambio de lote en etiquetas' }), /Hay 2 partidas de ETIQUETA ASHWAGANDHA/u);
  const selected = await advanceCloseGuide({ ...base,
    rawText: 'cambia lote de partida 3' });
  assert.equal(selected.draft.materialChoice.index, 2);
  assert.equal(selected.draft.materials[0].lote, 'AA-260929-01-ETASH');
  assert.equal(selected.params, undefined);
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
  assert.match(premature.message, /No hay lotes/u);
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

function gomasDraft(materials) {
  return { orderId: 113, conforming: 19, waste: 1, wasteClassified: true,
    reason: 'defecto', location: 'C2', materials, materialsAnswered: true,
    materialPending: null, materialChoice: null, reviewShown: true };
}

function gomasLine(quantity, lot = 'GOMEZ-L24', location = 'A8') {
  return { sku: '00050-MPRO', producto: 'GOMAS PROBIOTICOS', unidad: 'g',
    cantidad: quantity, lote: lot, motivo: 'derrame', ubicacion: location };
}

test('OP 113 corrige 120 a 100 g en la partida existente sin pedir de nuevo el lote', async () => {
  for (const phrase of ['Corrección partida 1, la reposición fue de 100 gramos.',
    'Corrección partida 1, 100 gramos', 'corrijo partida 1 a 100 g',
    'la reposición de gomas fue de 100 gramos', 'corrige cantidad de gomas a 100 gramos']) {
    const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
      initialDraft: gomasDraft([gomasLine(120)]) });
    const result = await advanceCloseGuide({ db, userId: 7, rawText: phrase });
    assert.equal(result.draft.materials[0].cantidad, 100, phrase);
    assert.equal(result.draft.materials.length, 1, phrase);
    assert.equal(result.draft.materialPending, null, phrase);
    assert.equal(result.draft.materialChoice, null, phrase);
    assert.match(result.message, /GOMAS PROBIOTICOS.*100 g/u);
    assert.doesNotMatch(result.message, /elige lote/u);
  }
});

test('una unidad singular también corrige cantidad de un insumo por partida', async () => {
  const db = fakeDb({ orderId: 113, planned: 20,
    initialDraft: gomasDraft([{ sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO',
      unidad: 'und', cantidad: 2, lote: 'ACC-260910-TPBI', motivo: 'ruptura', ubicacion: 'A8' }]) });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección partida 1, 1 unidad' });
  assert.equal(result.draft.materials[0].cantidad, 1);
  assert.equal(result.draft.materials[0].lote, 'ACC-260910-TPBI');
});

test('OP 113 acepta corrección directa de partida 3 y no inventa cantidad si falta', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
    stockAvailable: 200, initialDraft: gomasDraft([
      { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und',
        cantidad: 2, lote: 'ACC-260910-TPBI', motivo: 'ruptura', ubicacion: 'A8' },
      { sku: '00017-ETASH60', producto: 'ETIQUETA ASHWAGANDHA', unidad: 'und',
        cantidad: 3, lote: 'AA-260929-01-ETASH', motivo: 'defecto', ubicacion: 'A1' },
      gomasLine(120),
    ]) });
  const incomplete = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección partida 3' });
  assert.equal(incomplete.draft.materials[2].cantidad, 120);
  await assert.rejects(() => advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección partida 3, 100 unidades' }), /se registra en g/u);
  const changed = await advanceCloseGuide({ db, userId: 7,
    rawText: 'Corrección partida 3, 100 gramos' });
  assert.equal(changed.draft.materials[2].cantidad, 100);
  assert.equal(changed.draft.materials[2].lote, 'GOMEZ-L24');
  assert.equal(changed.draft.materials.length, 3);
  assert.equal(changed.draft.materialChoice, null);
  assert.match(changed.message, /GOMAS PROBIOTICOS.*100 g/u);
});

test('una opción de lote duplicada sale del bucle y permite corregir el total', async () => {
  const draft = gomasDraft([gomasLine(120)]);
  draft.materialPending = { ...gomasLine(100), lote: null, motivo: null, ubicacion: null };
  draft.materialsAnswered = false;
  draft.materialChoice = { target: 'pending', index: null, sku: '00050-MPRO',
    producto: 'GOMAS PROBIOTICOS', cantidad: 100, unidad: 'g', page: 0,
    options: [{ lote: 'GOMEZ-L24', ubicacion: 'A8', disponible: 200 }] };
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true, stockAvailable: 200,
    replacementOptions: draft.materialChoice.options, initialDraft: draft });
  const choice = await advanceCloseGuide({ db, userId: 7, rawText: 'opción 1' });
  assert.equal(choice.draft.materialPending, null);
  assert.equal(choice.draft.materialChoice, null);
  assert.equal(choice.draft.materials[0].cantidad, 120);
  assert.match(choice.message, /No agregué una segunda reposición/u);
  assert.doesNotMatch(choice.message, /elige lote/u);
  const correction = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección: partida 1, cantidad 100 gramos' });
  assert.equal(correction.draft.materials[0].cantidad, 100);
  assert.equal(correction.draft.materials.length, 1);
});

test('con varias partidas del mismo SKU exige número y conserva lote y ubicación', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true, stockAvailable: 200,
    stockLocations: { 'LOTE-2': 'A14' }, initialDraft: gomasDraft([
      gomasLine(120), gomasLine(80, 'LOTE-2', 'A14'),
    ]) });
  await assert.rejects(() => advanceCloseGuide({ db, userId: 7,
    rawText: 'la reposición de gomas fue de 100 gramos' }), /Hay 2 partidas/u);
  const corrected = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección: partida 2, cantidad 100 gramos' });
  assert.deepEqual(corrected.draft.materials.map(line => [line.cantidad, line.lote, line.ubicacion]),
    [[120, 'GOMEZ-L24', 'A8'], [100, 'LOTE-2', 'A14']]);
});

test('corrige causa y ubicación de una partida específica sin afectar la otra', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
    stockAvailable: 200, stockLocations: { 'LOTE-2': 'A14' },
    initialDraft: gomasDraft([gomasLine(120), gomasLine(80, 'LOTE-2', 'A14')]) });
  const cause = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección: partida 2, causa contaminación' });
  assert.equal(cause.draft.materials[1].motivo, 'contaminacion');
  assert.equal(cause.draft.materials[0].motivo, 'derrame');
  const location = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección: partida 2, ubicación es A14' });
  assert.equal(location.draft.materials[1].ubicacion, 'A14');
  assert.equal(location.draft.materials[0].ubicacion, 'A8');
  assert.equal(location.draft.materials.length, 2);
});

test('una partida repuesta puede cambiar de ubicación con lenguaje natural sin mover el terminado', async () => {
  for (const phrase of ['partida 1 va para la A14',
    'corrección: partida 1 queda en la A14']) {
    const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
      stockAvailable: 200, stockLocations: { 'LOTE-OLD': 'A8', 'LOTE-NEW': 'A14' },
      replacementOptions: [
        { lote: 'LOTE-OLD', ubicacion: 'A8', disponible: 200 },
        { lote: 'LOTE-NEW', ubicacion: 'A14', disponible: 200 },
      ], initialDraft: gomasDraft([gomasLine(120, 'LOTE-OLD', 'A8')]) });
    const changed = await advanceCloseGuide({ db, userId: 7, rawText: phrase });
    assert.equal(changed.draft.materials[0].ubicacion, 'A14', phrase);
    assert.equal(changed.draft.location, 'C2', phrase);
    assert.equal(changed.draft.materials[0].lote, null, phrase);
    assert.deepEqual(changed.draft.materialChoice.options.map(row => row.lote), ['LOTE-NEW'], phrase);
  }
});

test('un destino sin objeto claro pide distinguir terminado y material', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
    initialDraft: gomasDraft([gomasLine(100)]) });
  const ambiguous = await advanceCloseGuide({ db, userId: 7, rawText: 'va para la C3' });
  assert.match(ambiguous.message, /¿Qué ubicación corriges\?/u);
  assert.equal(ambiguous.draft.location, 'C2');
  assert.equal(ambiguous.draft.materials[0].ubicacion, 'A8');
  const finished = await advanceCloseGuide({ db, userId: 7,
    rawText: 'el conforme va para la C3' });
  assert.equal(finished.draft.location, 'C3');
  assert.equal(finished.draft.materials[0].ubicacion, 'A8');
  assert.equal(isCloseFollowup('va para la C3', finished.draft), true);
});

test('con varios lotes, cambiar lote de partida 2 abre opciones sin tratar «de» como lote', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
    stockAvailable: 200, stockLocations: { 'LOTE-2': 'A14' },
    replacementOptions: [{ lote: 'LOTE-3', ubicacion: 'A14', disponible: 200 }],
    initialDraft: gomasDraft([gomasLine(120), gomasLine(80, 'LOTE-2', 'A14')]) });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'cambia lote de partida 2' });
  assert.equal(result.draft.materialChoice.target, 'existing');
  assert.equal(result.draft.materialChoice.index, 1);
  assert.equal(result.draft.materials[1].lote, 'LOTE-2');
  assert.match(result.message, /elige lote/u);
});

test('al corregir ubicación de un insumo solo ofrece lotes de la ubicación nueva', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
    stockAvailable: 200, stockLocations: { 'LOTE-OLD': 'A8', 'LOTE-NEW': 'A14' },
    replacementOptions: [
      { lote: 'LOTE-OLD', ubicacion: 'A8', disponible: 200 },
      { lote: 'LOTE-NEW', ubicacion: 'A14', disponible: 200 },
    ], initialDraft: gomasDraft([gomasLine(120, 'LOTE-OLD', 'A8')]) });
  const changed = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección: partida 1, ubicación A14' });
  assert.equal(changed.draft.materials[0].ubicacion, 'A14');
  assert.equal(changed.draft.materials[0].lote, null);
  assert.deepEqual(changed.draft.materialChoice.options.map(row => row.lote), ['LOTE-NEW']);
});

test('corrige conformes, no conformes y ubicación sin tocar las reposiciones', async () => {
  const db = fakeDb({ orderId: 113, planned: 20, withGomas: true,
    initialDraft: gomasDraft([gomasLine(100)]) });
  const result = await advanceCloseGuide({ db, userId: 7,
    rawText: 'corrección: conformes a 18, no conformes a 2, ubicación del conforme a C3' });
  assert.equal(result.draft.conforming, 18);
  assert.equal(result.draft.waste, 2);
  assert.equal(result.draft.location, 'C3');
  assert.equal(result.draft.materials[0].cantidad, 100);
  assert.equal(result.draft.reviewShown, true);
});
