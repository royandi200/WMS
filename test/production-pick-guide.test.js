const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceProductionPick, allocationFingerprint, explicitPickConfirmation,
  isPickCorrection, pickLocations,
} = require('../api/_lib/production-pick-guide');

function fakeDb({ a10Quantity = 12, extraA10Lot = false, extraA11Lot = false,
  extraTarroPart = false, notices = [] } = {}) {
  let snapshot = null;
  let review = null;
  let nextId = 3;
  let allocations = [
    { id: 1, produccion_material_id: 10, stock_id: 11, lote: 'R5-260923-TRP',
      ubicacion_id: 1, cantidad_reservada: 7, producto_id: 6, unidad: 'und',
      bodega_id: 1, sku: '00006-TRP', producto: 'TARRO CUADRADO x 60', ubicacion: 'A11' },
    { id: 2, produccion_material_id: 20, stock_id: 21, lote: 'R5-260923-TPBI',
      ubicacion_id: 3, cantidad_reservada: 7, producto_id: 1, unidad: 'und',
      bodega_id: 1, sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO', ubicacion: 'A8' },
  ];
  if (extraTarroPart) allocations.push({ ...allocations[0], id: 3, stock_id: 13,
    ubicacion_id: 4, cantidad_reservada: 2, ubicacion: 'A9' });
  const stocks = new Map([
    [11, { id: 11, lote: 'R5-260923-TRP', ubicacion_id: 1, ubicacion: 'A11',
      cantidad: 10, reservada: 7, productId: 6, status: 'DISPONIBLE' }],
    [12, { id: 12, lote: 'R5-260923-TRP', ubicacion_id: 2, ubicacion: 'A10',
      cantidad: a10Quantity, reservada: 0, productId: 6, status: 'DISPONIBLE' }],
    [13, { id: 13, lote: 'R6-260925-TRP', ubicacion_id: 4, ubicacion: 'A9',
      cantidad: 10, reservada: extraTarroPart ? 2 : 0, productId: 6, status: 'DISPONIBLE' }],
    ...(extraA10Lot ? [[14, { id: 14, lote: 'R7-260927-TRP', ubicacion_id: 2,
      ubicacion: 'A10', cantidad: 10, reservada: 0, productId: 6,
      status: 'DISPONIBLE', vence: '2027-12-31' }]] : []),
    ...(extraA11Lot ? [[15, { id: 15, lote: 'R8-260928-TRP', ubicacion_id: 1,
      ubicacion: 'A11', cantidad: 9, reservada: 0, productId: 6,
      status: 'DISPONIBLE', vence: '2028-06-30' }]] : []),
    [21, { id: 21, lote: 'R5-260923-TPBI', ubicacion_id: 3, ubicacion: 'A8',
      cantidad: 10, reservada: 7, productId: 1, status: 'DISPONIBLE' }],
  ]);
  const db = {
    get review() { return review; },
    get allocations() { return allocations; },
    get stocks() { return stocks; },
    async beginTransaction() {
      snapshot = { allocations: structuredClone(allocations),
        stocks: structuredClone([...stocks]), review: structuredClone(review) };
    },
    async commit() { snapshot = null; },
    async rollback() {
      if (!snapshot) return;
      allocations = snapshot.allocations;
      stocks.clear();
      for (const [id, stock] of snapshot.stocks) stocks.set(id, stock);
      review = snapshot.review;
      snapshot = null;
    },
    async execute(sql, params = []) {
      if (sql.includes('FROM produccion_alistamiento_revisiones')) {
        return [review ? [{ order_id: review.orderId, huella: review.hash,
          choice_json: review.choice }] : []];
      }
      if (sql.includes('FROM notificaciones_salida')) return [notices.map(id => ({
        evento: `production_released:${id}` }))];
      if (sql.includes('FROM ordenes_produccion op JOIN productos p')) return [[{
        id: params[0], codigo_orden: `OP-20260930-${String(params[0]).padStart(6, '0')}`,
        estado: 'APROBADA', fase: 'F0', producto_sku: '00102-PTASH60',
        producto_nombre: 'ASHWAGANDHA X 60',
      }]];
      if (sql.includes('FROM produccion_material_lotes pml')) return [allocations
        .map(row => ({ ...row })).sort((a, b) => a.id - b.id)];
      if (sql.includes('FROM stock s') && sql.includes('JOIN lots l')) {
        return [[...stocks.values()].filter(stock => stock.productId === Number(params[0])
          && (sql.includes('UPPER(s.lote)')
            ? (stock.lote.toUpperCase() === String(params[2]).toUpperCase()
              && (!params[3] || stock.ubicacion === params[3])
              && (!params[5] || stock.id === Number(params[5])))
            : (!params[2] || stock.ubicacion === params[2])))];
      }
      if (sql.includes('FROM productos p') && sql.includes('LEFT JOIN skus')) return [[]];
      if (sql.includes('FROM producto_aliases pa')) return [[]];
      if (sql.includes('FROM productos p') && sql.includes('LEFT JOIN producto_aliases')) {
        return [[{ id: 6, siigo_code: '00006-TRP', nombre: 'TARRO CUADRADO x 60' },
          { id: 1, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO' }]];
      }
      if (sql.includes('UPDATE stock SET reservada = reservada -')) {
        const stock = stocks.get(Number(params[1]));
        if (!stock || stock.reservada < Number(params[2])) return [{ affectedRows: 0 }];
        stock.reservada -= Number(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE stock SET reservada = reservada +')) {
        const stock = stocks.get(Number(params[1]));
        if (!stock || stock.cantidad - stock.reservada < Number(params[2])) return [{ affectedRows: 0 }];
        stock.reservada += Number(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('UPDATE produccion_material_lotes')) {
        const row = allocations.find(item => item.id === Number(params[4]));
        const stock = stocks.get(Number(params[0]));
        Object.assign(row, { stock_id: stock.id, lote: params[1], ubicacion_id: params[2],
          cantidad_reservada: params[3], ubicacion: stock.ubicacion });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO produccion_material_lotes')) {
        const source = allocations.find(item => item.produccion_material_id === Number(params[0]));
        const stock = stocks.get(Number(params[1]));
        allocations.push({ ...source, id: ++nextId, stock_id: stock.id, lote: params[2],
          ubicacion_id: params[3], cantidad_reservada: params[4], ubicacion: stock.ubicacion });
        return [{ insertId: nextId, affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO produccion_alistamiento_revisiones')) {
        review = { orderId: params[1], hash: params[2], choice: params[3] };
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO system_logs')) return [{ insertId: 1, affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return db;
}

test('una orden de confirmar primero muestra las partidas; solo una frase explícita confirma después', async () => {
  const db = fakeDb();
  const first = await advanceProductionPick({ db, userId: 7,
    rawText: 'confirmo materiales OP ID 110' });
  assert.equal(first.confirm, undefined);
  assert.match(first.message, /Revisa el alistamiento de OP ID 110/u);
  assert.match(first.message, /1\. \*TARRO CUADRADO/u);
  assert.equal(db.review.hash, allocationFingerprint(db.allocations));
  const second = await advanceProductionPick({ db, userId: 7,
    rawText: 'Confirmo materiales OP ID 110' });
  assert.equal(second.confirm, true);
  assert.equal(second.orderId, 110);
  assert.equal(db.stocks.get(11).reservada, 7);
});

test('una negación transcrita como «los dos» corrige contexto o pide partida, nunca confirma', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'los dos no estaban en la ubicación a 11 estaban en la ubicación a 10' });
  assert.equal(offered.confirm, undefined);
  assert.match(offered.message, /elige el lote/u);
  assert.equal(db.allocations[0].stock_id, 11);
  const corrected = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.match(corrected.message, /Corrección aplicada a la partida 1/u);
  assert.match(corrected.message, /ubicación: A10/u);
  assert.equal(db.allocations[0].stock_id, 12);
  assert.equal(db.stocks.get(11).reservada, 0);
  assert.equal(db.stocks.get(12).reservada, 7);
});

test('el único aviso de alistamiento permite corregir sin repetir OP ID, pero varios avisos no se adivinan', async () => {
  const db = fakeDb({ notices: [110] });
  const corrected = await advanceProductionPick({ db, userId: 7, from: '573000000000',
    rawText: 'los dos no estaban en la ubicación a 11 estaban en la ubicación a 10' });
  assert.equal(corrected.confirm, undefined);
  assert.match(corrected.message, /elige el lote/u);
  await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.equal(db.allocations[0].ubicacion, 'A10');

  const ambiguous = fakeDb({ notices: [110, 111] });
  const reply = await advanceProductionPick({ db: ambiguous, userId: 7,
    from: '573000000000', rawText: 'corrección: partida 1, ubicación A10' });
  assert.match(reply.message, /Indica la OP que vas a alistar/u);
  assert.equal(ambiguous.allocations[0].ubicacion, 'A11');
});

test('el operario corrige por número sin repetir SKU ni lote y puede cambiar a otro lote', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const result = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: partida 1, lote R6-260925-TRP en A9' });
  assert.match(result.message, /Lote: R6-260925-TRP \| ubicación: A9/u);
  assert.equal(db.allocations[0].stock_id, 13);
  assert.equal(db.stocks.get(11).reservada, 0);
  assert.equal(db.stocks.get(13).reservada, 7);
});

test('cambiar ubicación ofrece los lotes del SKU y opción 2 aplica solo el elegido', async () => {
  const db = fakeDb({ extraA10Lot: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: partida 1, ubicación A10' });
  assert.match(offered.message, /1\. Lote R5-260923-TRP/u);
  assert.match(offered.message, /2\. Lote R7-260927-TRP/u);
  assert.match(offered.message, /Partida 1: TARRO CUADRADO x 60/u);
  assert.match(offered.message, /Actual: lote R5-260923-TRP \| ubicación A11/u);
  assert.doesNotMatch(offered.message, /Materiales reservados|TAPA TARRO CUADRADO BLANCO/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.ok(db.review.choice);
  const blocked = await advanceProductionPick({ db, userId: 7,
    rawText: 'Confirmo materiales OP ID 110' });
  assert.equal(blocked.confirm, undefined);
  assert.match(blocked.message, /Falta elegir el lote/u);
  assert.doesNotMatch(blocked.message, /Materiales reservados|TAPA TARRO CUADRADO BLANCO/u);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 2' });
  assert.match(chosen.message, /Corrección aplicada a la partida 1/u);
  assert.match(chosen.message, /Lote: R7-260927-TRP \| ubicación: A10/u);
  assert.match(chosen.message, /Materiales reservados/u);
  assert.equal(db.allocations[0].stock_id, 14);
  assert.equal(db.review.choice, null);
  assert.equal(db.stocks.get(11).reservada, 0);
  assert.equal(db.stocks.get(14).reservada, 7);
});

test('una opción inexistente no altera la reserva y repite la lista', async () => {
  const db = fakeDb({ extraA10Lot: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: partida 1, ubicación A10' });
  const reply = await advanceProductionPick({ db, userId: 7, rawText: 'opción 3' });
  assert.match(reply.message, /La opción 3 no existe/u);
  assert.doesNotMatch(reply.message, /Materiales reservados|TAPA TARRO CUADRADO BLANCO/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.equal(db.stocks.get(11).reservada, 7);
});

test('permite escoger otro lote en la ubicación actual sin dictar el código', async () => {
  const db = fakeDb({ extraA11Lot: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: partida 1, quiero elegir otro lote' });
  assert.match(offered.message, /Para la ubicación A11, elige el lote/u);
  assert.match(offered.message, /1\. Lote R8-260928-TRP/u);
  assert.doesNotMatch(offered.message, /1\. Lote R5-260923-TRP/u);
  assert.equal(db.allocations[0].stock_id, 11);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.match(chosen.message, /Lote: R8-260928-TRP \| ubicación: A11/u);
  assert.equal(db.allocations[0].stock_id, 15);
  assert.equal(db.stocks.get(11).reservada, 0);
  assert.equal(db.stocks.get(15).reservada, 7);
});

test('una corrección flexible de lote ofrece opciones sin exigir una frase fija', async () => {
  const db = fakeDb({ extraA11Lot: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección en la partida 1 quiero cambiar el lote' });
  assert.match(offered.message, /1\. Lote R8-260928-TRP/u);
  assert.doesNotMatch(offered.message, /Materiales reservados|TAPA TARRO CUADRADO BLANCO/u);
  assert.equal(db.allocations[0].stock_id, 11);
});

test('otra formulación inequívoca permite cambiar de lote sin dictarlo', async () => {
  const db = fakeDb({ extraA11Lot: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección de la partida 1, el lote no es el correcto' });
  assert.match(offered.message, /1\. Lote R8-260928-TRP/u);
  assert.equal(db.allocations[0].stock_id, 11);
  const alternative = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección en la partida 1, quiero cambiar de lote' });
  assert.match(alternative.message, /1\. Lote R8-260928-TRP/u);
});

test('cambiar ubicación sin saber el código ofrece destinos y aplica el único lote apto', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección de partida 1 la ubicación no es esta' });
  assert.match(offered.message, /1\. Ubicación A9/u);
  assert.match(offered.message, /2\. Ubicación A10/u);
  assert.doesNotMatch(offered.message, /Ubicación A11|TAPA TARRO CUADRADO BLANCO|Materiales reservados/u);
  assert.equal(db.allocations[0].stock_id, 11);
  const blocked = await advanceProductionPick({ db, userId: 7,
    rawText: 'Confirmo materiales OP ID 110' });
  assert.equal(blocked.confirm, undefined);
  assert.match(blocked.message, /Falta elegir la ubicación/u);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 2' });
  assert.match(chosen.message, /Materiales reservados/u);
  assert.match(chosen.message, /Lote: R5-260923-TRP \| ubicación: A10/u);
  assert.equal(db.allocations[0].stock_id, 12);
  assert.equal(db.review.choice, null);
});

test('al elegir ubicación con varios lotes pide el lote antes de cambiar la reserva', async () => {
  const db = fakeDb({ extraA10Lot: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const locations = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección partida 1 quiero cambiar ubicación' });
  assert.match(locations.message, /2\. Ubicación A10 \| 2 lotes aptos/u);
  const lots = await advanceProductionPick({ db, userId: 7, rawText: 'opción 2' });
  assert.match(lots.message, /Para la ubicación A10, elige el lote/u);
  assert.match(lots.message, /1\. Lote R5-260923-TRP/u);
  assert.match(lots.message, /2\. Lote R7-260927-TRP/u);
  assert.doesNotMatch(lots.message, /Materiales reservados|TAPA TARRO CUADRADO BLANCO/u);
  assert.equal(db.allocations[0].stock_id, 11);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 2' });
  assert.match(chosen.message, /Lote: R7-260927-TRP \| ubicación: A10/u);
  assert.match(chosen.message, /Materiales reservados/u);
  assert.equal(db.allocations[0].stock_id, 14);
});

test('«los tarros» identifica el producto del resumen sin exigir su SKU', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const result = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: los tarros estaban en la ubicación A10' });
  assert.match(result.message, /elige el lote/u);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.match(chosen.message, /Corrección aplicada a la partida 1/u);
  assert.equal(db.allocations[0].stock_id, 12);
});

test('una corrección natural de ubicación conserva el producto contextual', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const result = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección, la ubicación correcta de los tarros es A10' });
  assert.match(result.message, /elige el lote/u);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.match(chosen.message, /Corrección aplicada a la partida 1/u);
  assert.equal(db.allocations[0].stock_id, 12);
});

test('el reparto conserva el total, crea una segunda partida y exige revisar otra vez', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const result = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: reparte partida 1: 4 en A10 y 3 del lote R6-260925-TRP en A9' });
  assert.match(result.message, /4 und/u);
  assert.match(result.message, /3 und/u);
  assert.equal(db.allocations.filter(row => row.producto_id === 6)
    .reduce((sum, row) => sum + Number(row.cantidad_reservada), 0), 7);
  assert.equal(db.stocks.get(11).reservada, 0);
  assert.equal(db.stocks.get(12).reservada, 4);
  assert.equal(db.stocks.get(13).reservada, 3);
});

test('si hay dos partidas del mismo SKU, un nombre sin número no cambia ninguna', async () => {
  const db = fakeDb({ extraTarroPart: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const reply = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: los tarros estaban en A10' });
  assert.match(reply.message, /partida N/u);
  assert.match(reply.message, /Materiales reservados/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.equal(db.stocks.get(11).reservada, 7);
});

test('una ubicación sin saldo suficiente revierte la corrección y el resumen previo queda inválido si cambian reservas', async () => {
  const db = fakeDb({ a10Quantity: 3 });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const reply = await advanceProductionPick({ db, userId: 7,
    rawText: 'corrección: partida 1, ubicación A10' });
  assert.match(reply.message, /mayor saldo por lote es 3/u);
  assert.match(reply.message, /No se cambiaron las reservas/u);
  assert.equal(db.stocks.get(11).reservada, 7);
  assert.equal(db.stocks.get(12).reservada, 0);
  db.allocations[0].cantidad_reservada = 6;
  await assert.rejects(advanceProductionPick({ db, userId: 7,
    rawText: 'Confirmo materiales OP ID 110' }), /resumen de materiales cambió/u);
});

test('confirmar otra OP o decir sí no ejecuta el inicio', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const yes = await advanceProductionPick({ db, userId: 7, rawText: 'sí' });
  assert.equal(yes.confirm, undefined);
  await assert.rejects(advanceProductionPick({ db, userId: 7,
    rawText: 'Confirmo materiales OP ID 111' }), /resumen de materiales cambió/u);
  assert.equal(db.stocks.get(11).reservada, 7);
  assert.equal(explicitPickConfirmation('sí'), false);
  assert.equal(explicitPickConfirmation('Confirmo materiales OPIV 110'), true);
  assert.equal(isPickCorrection('los tarros no estaban en A11, estaban en A10'), true);
  assert.equal(isPickCorrection('a10 y no de la a14'), true);
  assert.deepEqual(pickLocations('ubicación a 11, ubicación a 10'), ['A11', 'A10']);
  assert.deepEqual(pickLocations('a10 y no de la a14'), ['A14', 'A10']);
});
