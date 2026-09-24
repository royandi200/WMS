const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceCloseGuide, closeFields, closeOrderReference, confirmed, isCloseFollowup,
} = require('../api/_lib/production-close-guide');
const { hasProductionCloseIntent } = require('../api/_lib/production-close-input');

function fakeDb() {
  let stored = null;
  const writes = [];
  return {
    writes,
    async execute(sql, params) {
      if (sql.includes('FROM produccion_cierre_borradores')) return [stored ? [{ payload_json: stored }] : []];
      if (sql.includes('FROM ordenes_produccion op')) return [[{
        id: 97, codigo_orden: 'OP-20260924-000097', estado: 'EN_PROCESO',
        cantidad_planeada: '2.000', producto_id: 74,
        sku: '00102-PTASH60', producto: 'ASHWAGANDHA X 60',
      }]];
      if (sql.includes('FROM producto_ubicaciones')) return [[{ codigo: 'C2' }]];
      if (sql.includes('FROM ubicaciones u JOIN bodegas b')) return [[{ codigo: 'C2' }]];
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
  assert.match(second.message, /Conformes: 2 und/u);
  assert.match(second.message, /0 merma/u);

  const third = await advanceCloseGuide({ ...base, rawText: 'cero merma' });
  assert.match(third.message, /Sugerida: \*C2\*/u);

  const fourth = await advanceCloseGuide({ ...base, rawText: 'C2' });
  assert.match(fourth.message, /confirmo cierre/u);
  assert.equal(fourth.params, undefined);

  const fifth = await advanceCloseGuide({ ...base, rawText: 'confirmo cierre' });
  assert.deepEqual(fifth.params, { id_orden: 97, cantidad_real: 2, merma: 0,
    motivo_merma: null, ubicacion: 'C2' });
  assert.equal(db.writes.length, 4);
});

test('el audio sin cantidades no puede convertirse en cierre por los parámetros del modelo', async () => {
  const db = fakeDb();
  const result = await advanceCloseGuide({ db, userId: 9,
    rawText: 'Cerramos producción OPIV 97',
    params: { id_orden: 97, cantidad_real: 2, merma: 0, ubicacion: 'C2' } });
  assert.equal(result.params, undefined);
  assert.match(result.message, /Conformes: pendiente/u);
  assert.match(result.message, /Merma de producto terminado: pendiente/u);
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
  assert.match(result.message, /Conformes: 1 und/u);
  assert.match(result.message, /Merma de producto terminado: 1 und/u);
  assert.match(result.message, /Sugerida: \*C2\*/u);
  assert.equal(result.params, undefined);
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
