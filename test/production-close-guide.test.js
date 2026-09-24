const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceCloseGuide, closeFields, closeOrderReference, confirmed, isCloseFollowup,
} = require('../api/_lib/production-close-guide');
const { hasProductionCloseIntent } = require('../api/_lib/production-close-input');

function fakeDb({ orderId = 97, planned = 2 } = {}) {
  let stored = null;
  const writes = [];
  const aliasTerms = [];
  return {
    writes, aliasTerms,
    async execute(sql, params) {
      if (sql.includes('FROM produccion_cierre_borradores')) return [stored ? [{ payload_json: stored }] : []];
      if (sql.includes('FROM webhook_logs')) return [[]];
      if (sql.includes('FROM notificaciones_salida')) return [[{ evento: `production_started:${orderId}` }]];
      if (sql.includes('FROM ordenes_produccion op')) return [[{
        id: orderId, codigo_orden: `OP-20260924-${String(orderId).padStart(6, '0')}`, estado: 'EN_PROCESO',
        cantidad_planeada: Number(planned).toFixed(3), producto_id: 74,
        sku: '00102-PTASH60', producto: 'ASHWAGANDHA X 60',
      }]];
      if (sql.includes('FROM producto_ubicaciones')) return [[{ codigo: 'C2' }]];
      if (sql.includes('FROM ubicaciones u JOIN bodegas b')) return [[{ codigo: 'C2' }]];
      if (sql.includes('FROM produccion_materiales pm JOIN productos')) return [[{
        producto_id: 6, unidad: 'und', sku: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO',
      }, { producto_id: 17, unidad: 'und', sku: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA' }]];
      if (sql.includes('FROM productos p') && sql.includes('LEFT JOIN skus')) return [[]];
      if (sql.includes('FROM producto_aliases pa')) { aliasTerms.push(params[0]); return [[params[0] === 'etiqueta' ? {
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
  assert.match(first.message, /cuántas unidades conformes/iu);
  assert.equal(first.params, undefined);

  const second = await advanceCloseGuide({ ...base, rawText: '2 conformes' });
  assert.match(second.message, /Unidades conformes: 2 und/u);
  assert.match(second.message, /Falta informar:.*merma, ubicación del producto conforme/u);
  assert.match(second.message, /0 merma/u);

  const third = await advanceCloseGuide({ ...base, rawText: 'cero merma' });
  assert.match(third.message, /Sugerida: \*C2\*/u);

  const fourth = await advanceCloseGuide({ ...base, rawText: 'C2' });
  assert.match(fourth.message, /¿Repusiste algún material/u);
  assert.equal(fourth.params, undefined);

  const fifth = await advanceCloseGuide({ ...base, rawText: 'no repuse material' });
  assert.match(fifth.message, /confirmo cierre/u);
  assert.equal(fifth.params, undefined);
  const sixth = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
  assert.deepEqual(sixth.params, { id_orden: 97, cantidad_real: 2, merma: 0,
    motivo_merma: null, ubicacion: 'C2', materiales_repuestos: [] });
  assert.equal(db.writes.length, 5);
});

test('an operator can begin a close using the sole notified OP without repeating its ID', async () => {
  const db = fakeDb();
  const result = await advanceCloseGuide({ db, userId: 21, from: '573001234567',
    rawText: 'cerramos producción' });
  assert.match(result.message, /OP ID 97/u);
  assert.equal(result.draft.orderId, 97);
  assert.equal(result.params, undefined);
});

test('el audio sin cantidades no puede convertirse en cierre por los parámetros del modelo', async () => {
  const db = fakeDb();
  const result = await advanceCloseGuide({ db, userId: 9,
    rawText: 'Cerramos producción OPIV 97',
    params: { id_orden: 97, cantidad_real: 2, merma: 0, ubicacion: 'C2' } });
  assert.equal(result.params, undefined);
  assert.match(result.message, /Unidades conformes: pendiente/u);
  assert.match(result.message, /Merma de producto terminado: pendiente/u);
  assert.match(result.message, /Motivo de la merma: se requiere si hubo merma/u);
  assert.match(result.message, /Ubicación del producto conforme: se requiere si hubo conformes/u);
  assert.match(result.message, /Puedes dar todos los datos juntos o por partes/u);
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
  assert.match(second.message, /¿Cuántas unidades conformes salieron/iu);
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
  assert.match(confirmedCandidate.message, /¿Cuántas unidades conformes salieron/iu);
  assert.equal(confirmedCandidate.draft.orderId, 97);
  assert.equal(confirmedCandidate.params, undefined);
});

test('una unidad conforme y una merma se capturan juntas sin inferir cierre', async () => {
  assert.deepEqual(closeFields('quedó una unidad conforme y una merma por destrucción'), {
    conforming: 1, waste: 1, reason: 'destruccion', location: null,
  });
  const db = fakeDb();
  const base = { db, userId: 13 };
  await advanceCloseGuide({ ...base, rawText: 'cerrar OP ID 97' });
  const result = await advanceCloseGuide({ ...base,
    rawText: 'quedó una unidad conforme y una merma por destrucción' });
  assert.match(result.message, /Unidades conformes: 1 und/u);
  assert.match(result.message, /Merma de producto terminado: 1 und/u);
  assert.match(result.message, /Motivo de la merma: destruccion/u);
  assert.match(result.message, /Falta informar:.*ubicación del producto conforme/u);
  assert.match(result.message, /Sugerida: \*C2\*/u);
  assert.equal(result.params, undefined);
});

test('audio ambiguo de OP 100 y merma posterior de tapas conservan el mismo cierre sin descontar inventario', async () => {
  const db = fakeDb({ orderId: 100, planned: 5 });
  const base = { db, userId: 100 };
  const first = await advanceCloseGuide({ ...base,
    rawText: 'cerramos op y de 100 con cuatro tarros conformes y una merma',
    params: { id_orden: 100, cantidad_real: 4, merma: 1 } });
  assert.equal(first.draft.orderId, 100);
  assert.equal(first.draft.conforming, null);
  assert.equal(first.draft.waste, 1);
  assert.match(first.message, /¿Son \*4 productos terminados conformes\*/u);
  assert.equal(first.params, undefined);

  const second = await advanceCloseGuide({ ...base,
    rawText: 'hubo merma de dos tapas por destrucción',
    params: { avance_materiales: { items: [{ producto: 'tapas', cantidad: 2, motivo: 'destrucción' }] } } });
  assert.equal(second.draft.waste, 1, 'el daño de tapas no cambia la merma del producto terminado');
  assert.equal(second.draft.materialPending.cantidad, 2);
  assert.equal(second.draft.materialPending.sku, '00001-TPBI');
  assert.equal(second.draft.materialPending.motivo, 'destruccion');
  assert.match(second.message, /¿Repusiste 2 und de TAPA/u);
  assert.equal(second.params, undefined);
  const affirmed = await advanceCloseGuide({ ...base, rawText: 'sí' });
  assert.match(affirmed.message, /¿De qué lote sacaste 2 und/u);
  const lot = await advanceCloseGuide({ ...base, rawText: 'lote ACC-260910-TPBI' });
  assert.equal(lot.draft.materials[0].cantidad, 2);
  assert.equal(lot.draft.materials[0].lote, 'ACC-260910-TPBI');
  assert.equal(lot.draft.waste, 1);
  const conforming = await advanceCloseGuide({ ...base, rawText: '4 conformes' });
  assert.equal(conforming.draft.conforming, 4);
  await advanceCloseGuide({ ...base, rawText: 'merma de producto terminado por rotura' });
  const review = await advanceCloseGuide({ ...base, rawText: 'ubicación C2' });
  assert.match(review.message, /confirmo cierre/u);
  const confirmation = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
  assert.equal(confirmation.params.cantidad_real, 4);
  assert.equal(confirmation.params.merma, 1);
  assert.deepEqual(confirmation.params.materiales_repuestos, [{
    sku: '00001-TPBI', cantidad: 2, lote: 'ACC-260910-TPBI',
    motivo: 'destruccion', ubicacion: undefined,
  }]);
  assert.ok(db.writes.every(sql => sql.includes('produccion_cierre_borradores')));
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
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
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
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
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
  const done = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
  assert.equal(done.params.materiales_repuestos[0].lote, 'L-NUEVO');
  assert.equal(done.params.materiales_repuestos[0].cantidad, 2);
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
  assert.equal(confirmed('sí'), true);
  assert.equal(confirmed('confirmo cierre'), true);
  assert.equal(isCloseFollowup('C2', { orderId: 97 }), true);
  assert.equal(isCloseFollowup('cuánto stock queda', { orderId: 97 }), false);
});
