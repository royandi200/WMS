const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceProductionPick, allocationFingerprint, explicitPickConfirmation, structuredPickIntent,
  isPickCorrection, pickLocations,
} = require('../api/_lib/production-pick-guide');

function fakeDb({ a9Quantity = 10, a10Quantity = 12, extraA10Lot = false, extraA11Lot = false,
  extraTarroPart = false, withEtiqueta = false, notices = [] } = {}) {
  let snapshot = null;
  let review = null;
  let nextId = withEtiqueta ? 4 : 3;
  let allocations = [
    { id: 1, produccion_material_id: 10, stock_id: 11, lote: 'R5-260923-TRP',
      ubicacion_id: 1, cantidad_reservada: 7, producto_id: 6, unidad: 'und',
      bodega_id: 1, sku: '00006-TRP', producto: 'TARRO CUADRADO x 60', ubicacion: 'A11' },
    { id: 2, produccion_material_id: 20, stock_id: 21, lote: 'R5-260923-TPBI',
      ubicacion_id: 3, cantidad_reservada: 7, producto_id: 1, unidad: 'und',
      bodega_id: 1, sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO', ubicacion: 'A8' },
  ];
  if (extraTarroPart) allocations.push({ ...allocations[0], id: 3, stock_id: 13,
    lote: 'R6-260925-TRP',
    ubicacion_id: 4, cantidad_reservada: 2, ubicacion: 'A9' });
  if (withEtiqueta) allocations.push({ id: 4, produccion_material_id: 30, stock_id: 31,
    lote: 'R5-260923-ETASH', ubicacion_id: 5, cantidad_reservada: 7,
    producto_id: 17, unidad: 'und', bodega_id: 1, sku: '00017-ETASH60',
    producto: 'ETIQUETA ASHWAGANDHA x 60', ubicacion: 'A1' });
  const stocks = new Map([
    [11, { id: 11, lote: 'R5-260923-TRP', ubicacion_id: 1, ubicacion: 'A11',
      cantidad: 10, reservada: 7, productId: 6, status: 'DISPONIBLE' }],
    [12, { id: 12, lote: 'R5-260923-TRP', ubicacion_id: 2, ubicacion: 'A10',
      cantidad: a10Quantity, reservada: 0, productId: 6, status: 'DISPONIBLE' }],
    [13, { id: 13, lote: 'R6-260925-TRP', ubicacion_id: 4, ubicacion: 'A9',
      cantidad: a9Quantity, reservada: extraTarroPart ? 2 : 0, productId: 6, status: 'DISPONIBLE' }],
    ...(extraA10Lot ? [[14, { id: 14, lote: 'R7-260927-TRP', ubicacion_id: 2,
      ubicacion: 'A10', cantidad: 10, reservada: 0, productId: 6,
      status: 'DISPONIBLE', vence: '2027-12-31' }]] : []),
    ...(extraA11Lot ? [[15, { id: 15, lote: 'R8-260928-TRP', ubicacion_id: 1,
      ubicacion: 'A11', cantidad: 9, reservada: 0, productId: 6,
      status: 'DISPONIBLE', vence: '2028-06-30' }]] : []),
    [21, { id: 21, lote: 'R5-260923-TPBI', ubicacion_id: 3, ubicacion: 'A8',
      cantidad: 10, reservada: 7, productId: 1, status: 'DISPONIBLE' }],
    ...(withEtiqueta ? [
      [31, { id: 31, lote: 'R5-260923-ETASH', ubicacion_id: 5, ubicacion: 'A1',
        cantidad: 10, reservada: 7, productId: 17, status: 'DISPONIBLE' }],
      [32, { id: 32, lote: 'R6-260925-ETASH', ubicacion_id: 5, ubicacion: 'A1',
        cantidad: 10, reservada: 0, productId: 17, status: 'DISPONIBLE' }],
    ] : []),
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
          { id: 1, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO' },
          ...(withEtiqueta ? [{ id: 17, siigo_code: '00017-ETASH60',
            nombre: 'ETIQUETA ASHWAGANDHA x 60' }] : [])]
          .filter(product => params.includes(product.id))];
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

test('audio «confirmo materiales o p y de» confirma solo la OP revisada y coincidente', async () => {
  const db = fakeDb();
  const first = await advanceProductionPick({ db, userId: 7,
    rawText: 'Revisa materiales OP ID 116' });
  assert.match(first.message, /Revisa el alistamiento de OP ID 116/u);
  assert.equal(explicitPickConfirmation('confirmo materiales o p y de 116'), true);
  const confirmed = await advanceProductionPick({ db, userId: 7,
    rawText: 'confirmo materiales o p y de 116' });
  assert.deepEqual(confirmed, { orderId: 116, confirm: true });
  await assert.rejects(advanceProductionPick({ db, userId: 7,
    rawText: 'confirmo materiales o p y de 117' }), /resumen de materiales cambió/u);
  assert.equal(explicitPickConfirmation('confirmo materiales o p y de 116 y cambia el lote'), false);
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

test('elegir ubicación sin saber el código muestra el lote único antes de reservarlo', async () => {
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
  const shown = await advanceProductionPick({ db, userId: 7, rawText: 'opción 2' });
  assert.match(shown.message, /Para la ubicación A10, elige el lote que verificaste físicamente/u);
  assert.match(shown.message, /1\. Lote R5-260923-TRP/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.equal(db.stocks.get(11).reservada, 7);
  assert.equal(db.stocks.get(12).reservada, 0);
  const awaitingLot = await advanceProductionPick({ db, userId: 7, rawText: 'Confirmo materiales OP ID 110' });
  assert.equal(awaitingLot.confirm, undefined);
  assert.match(awaitingLot.message, /Falta elegir el lote/u);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.match(chosen.message, /Materiales reservados/u);
  assert.match(chosen.message, /Lote: R5-260923-TRP \| ubicación: A10/u);
  assert.equal(db.allocations[0].stock_id, 12);
  assert.equal(db.review.choice, null);
});

test('una ubicación y un lote se presentan juntos y requieren una confirmación explícita del cambio', async () => {
  const db = fakeDb({ a9Quantity: 0 });
  const send = rawText => advanceProductionPick({ db, userId: 7, rawText });
  await send('Revisa materiales OP ID 110');
  const proposal = await send('¿De dónde más puedo sacar los tarros?');
  assert.match(proposal.message, /Única alternativa: A10 \| lote R5-260923-TRP/u);
  assert.match(proposal.message, /«Confirmo el cambio»/u);
  assert.doesNotMatch(proposal.message, /1\. Ubicación|Elige por número/u);
  for (const text of ['1', 'opción 1', 'sí', 'Confirmo materiales OP ID 110']) {
    const result = await send(text);
    assert.equal(result.confirm, undefined, text);
    assert.match(result.message, /Aún no cambié la reserva/u, text);
    assert.equal(db.allocations[0].stock_id, 11, text);
    assert.equal(db.stocks.get(12).reservada, 0, text);
  }
  const changed = await send('Sí, confirmo el cambio');
  assert.match(changed.message, /Corrección aplicada a la partida 1/u);
  assert.equal(changed.confirm, undefined);
  assert.equal(db.allocations[0].stock_id, 12);
  assert.equal(db.stocks.get(12).reservada, 7);
  assert.equal(db.stocks.get(12).cantidad, 12);
  assert.match((await send('Confirmo el cambio')).message, /No hay un cambio pendiente/u);
  assert.equal(db.stocks.get(12).reservada, 7);
  assert.equal((await send('Confirmo materiales OP ID 110')).confirm, true);
});

test('una sola ubicación con varios lotes abre directamente la lista de lotes', async () => {
  const db = fakeDb({ a9Quantity: 0, extraA10Lot: true });
  const send = rawText => advanceProductionPick({ db, userId: 7, rawText });
  await send('Revisa materiales OP ID 110');
  const proposal = await send('¿De dónde más puedo sacar los tarros?');
  assert.match(proposal.message, /Para la ubicación A10, elige el lote/u);
  assert.match(proposal.message, /2\. Lote R7-260927-TRP/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.match((await send('Confirmo el cambio')).message, /Primero indica la opción que cotejaste/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.match((await send('opción 2')).message, /Corrección aplicada/u);
  assert.equal(db.allocations[0].stock_id, 14);
});

test('la intención de BBC requiere evidencia literal y no admite campos que cambien inventario', () => {
  const evidence = 'de dónde puedo sacar otros liners?';
  const valid = { tipo: 'OTRA_UBICACION', producto: 'liners', evidencia: evidence };
  assert.deepEqual(structuredPickIntent({ intencion_alistamiento: valid }, evidence),
    { kind: 'location', reference: 'liners' });
  assert.deepEqual(structuredPickIntent({ intencion_alistamiento: {
    ...valid, tipo: 'OTRO_LOTE',
  } }, evidence), { kind: 'lot', reference: 'liners' });
  assert.deepEqual(structuredPickIntent({ intencion_alistamiento: {
    tipo: 'ACLARAR', evidencia: 'Hay que cambiar eso',
  } }, 'Hay que cambiar eso'), { kind: 'clarify' });
  for (const value of [
    { ...valid, producto: 'tapas' }, { ...valid, producto: 'liner' },
    { ...valid, evidencia: 'sacar los liners' }, { ...valid, lote: 'L1' },
    { ...valid, tipo: 'INICIAR_PRODUCCION' },
  ]) {
    assert.throws(() => structuredPickIntent({ intencion_alistamiento: value }, evidence), { status: 409 });
  }
  assert.throws(() => structuredPickIntent({ intencion_alistamiento: valid, id_orden: 999 }, evidence), { status: 409 });
});

test('la intención de BBC busca alternativas sin depender de una frase reconocida ni aplicar cambios', async () => {
  const db = fakeDb({ a9Quantity: 0 });
  const before = allocationFingerprint(db.allocations);
  const rawText = '¿Dónde consigo otros tarros?';
  assert.equal(isPickCorrection(rawText), false);
  const intent = structuredPickIntent({ intencion_alistamiento: {
    tipo: 'OTRA_UBICACION', producto: 'tarros', evidencia: rawText,
  } }, rawText);
  const blocked = await advanceProductionPick({ db, userId: 7, rawText, intent });
  assert.match(blocked.message, /Revisa primero los materiales/u);
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const proposed = await advanceProductionPick({ db, userId: 7, rawText, intent });
  assert.match(proposed.message, /Única alternativa: A10 \| lote R5-260923-TRP/u);
  assert.equal(proposed.confirm, undefined);
  assert.equal(allocationFingerprint(db.allocations), before);
  assert.equal(db.stocks.get(12).reservada, 0);
  const wrongOrder = await advanceProductionPick({ db, userId: 7,
    rawText: '¿Dónde consigo otros tarros para OP ID 111?', intent });
  assert.match(wrongOrder.message, /Revisa primero los materiales/u);
  const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'Confirmo el cambio' });
  assert.match(chosen.message, /Corrección aplicada/u);
  assert.equal(db.stocks.get(12).reservada, 7);
});

test('si se agota el lote propuesto, muestra el nuevo sin aplicar la confirmación al reemplazo', async () => {
  const db = fakeDb({ a9Quantity: 0 });
  const send = rawText => advanceProductionPick({ db, userId: 7, rawText });
  await send('Revisa materiales OP ID 110');
  await send('¿De dónde más puedo sacar los tarros?');
  db.stocks.get(12).reservada = 12;
  db.stocks.get(13).cantidad = 10;
  const refreshed = await send('Confirmo el cambio');
  assert.match(refreshed.message, /saldo o la disponibilidad cambió/u);
  assert.match(refreshed.message, /Única alternativa: A9 \| lote R6-260925-TRP/u);
  assert.equal(db.allocations[0].stock_id, 11);
  assert.equal(db.stocks.get(13).reservada, 0);
  const cancel = await send('No coincide');
  assert.match(cancel.message, /No cambié nada/u);
  assert.match((await send('Confirmo el cambio')).message, /No hay un cambio pendiente/u);
  assert.equal(db.allocations[0].stock_id, 11);
});

test('frases de bodega ofrecen ubicación o lote sin pedir códigos ni cambiar la reserva', async () => {
  for (const [phrase, expected] of [
    ['No encontré las etiquetas donde me mandaste. ¿De dónde más las puedo sacar?', /No hay otra ubicación registrada.*ETIQUETA ASHWAGANDHA/u],
    ['Las etiquetas sí están ahí, pero no encuentro ese lote. ¿Qué otro lote puedo usar?', /1\. Lote R6-260925-ETASH/u],
    ['En ese sitio no encuentro las tapas. ¿Hay otro lugar para sacar lo que falta?', /No hay otra ubicación registrada.*TAPA/u],
    ['¿De dónde más puedo sacar los tarros?', /Ubicación A10/u],
    ['¿Hay otro rack para los tarros?', /Ubicación A10/u],
    ['Necesito otro lote de los tarros', /1\. Lote R8-260928-TRP/u],
  ]) {
    const db = fakeDb({ withEtiqueta: true, extraA11Lot: true });
    const before = allocationFingerprint(db.allocations);
    await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
    const result = await advanceProductionPick({ db, userId: 7, rawText: phrase });
    assert.match(result.message, expected, phrase);
    assert.equal(allocationFingerprint(db.allocations), before, phrase);
  }
});

test('la cantidad aclara solo una partida del material preguntado y conserva la intención', async () => {
  const db = fakeDb({ extraTarroPart: true, extraA10Lot: true });
  const before = allocationFingerprint(db.allocations);
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const clarify = await advanceProductionPick({ db, userId: 7, rawText: 'Los tarros no están donde dice. ¿De dónde más saco?' });
  assert.match(clarify.message, /tiene 2 partidas \(1, 3\)/u);
  assert.match(clarify.message, /^Partida 1: TARRO CUADRADO x 60: 7 und/mu);
  assert.match(clarify.message, /^Partida 3: TARRO CUADRADO x 60: 2 und/mu);
  for (const reply of ['Las dos tapas que tengo que recoger juntas', '3', 'lote 1', 'Confirmo materiales OP ID 110']) {
    const blocked = await advanceProductionPick({ db, userId: 7, rawText: reply });
    assert.equal(blocked.confirm, undefined, reply);
    assert.match(blocked.message, /Indica cuál corriges/u, reply);
    assert.equal(allocationFingerprint(db.allocations), before, reply);
  }
  const offered = await advanceProductionPick({ db, userId: 7, rawText: 'Los dos tarros que tengo que recoger juntos' });
  assert.match(offered.message, /Partida 3: TARRO CUADRADO/u);
  assert.match(offered.message, /Ubicación A10/u);
  assert.equal(allocationFingerprint(db.allocations), before);
});

test('cancelar una corrección o hablar sin referente no selecciona alternativas antiguas', async () => {
  for (const phrase of ['Todavía no sé cuál es, no me cambies nada', 'Cámbiame eso por lo otro']) {
    const db = fakeDb();
    await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
    await advanceProductionPick({ db, userId: 7, rawText: '¿De dónde más puedo sacar los tarros?' });
    const result = await advanceProductionPick({ db, userId: 7, rawText: phrase });
    assert.match(result.message, /No cambié nada|Qué material quieres corregir/u, phrase);
    assert.equal(db.review.choice, null, phrase);
    const staleNumber = await advanceProductionPick({ db, userId: 7, rawText: '1' });
    assert.match(staleNumber.message, /No hay una selección vigente/u, phrase);
    assert.equal(db.allocations[0].stock_id, 11, phrase);
  }
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

test('un nombre inequívoco permite cambiar el lote de las etiquetas sin mencionar partida', async () => {
  const db = fakeDb({ withEtiqueta: true });
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const offered = await advanceProductionPick({ db, userId: 7,
    rawText: 'quiero cambiar el lote de las etiquetas' });
  assert.match(offered.message, /Partida 3: ETIQUETA ASHWAGANDHA/u);
  assert.match(offered.message, /1\. Lote R6-260925-ETASH/u);
  assert.equal(db.allocations[2].stock_id, 31);
  const selected = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
  assert.match(selected.message, /Corrección aplicada a la partida 3/u);
  assert.equal(db.allocations[2].stock_id, 32);
  assert.equal(db.allocations[0].stock_id, 11);
});

test('un nombre singular y un SKU exacto identifican el tarro sin confundir el SKU con un lote', async () => {
  const byName = fakeDb();
  await advanceProductionPick({ db: byName, userId: 7,
    rawText: 'Revisa materiales OP ID 110' });
  const location = await advanceProductionPick({ db: byName, userId: 7,
    rawText: 'corrige la ubicación del tarro a A10' });
  assert.match(location.message, /Partida 1: TARRO CUADRADO/u);
  assert.equal(byName.allocations[0].stock_id, 11);

  const bySku = fakeDb({ extraA11Lot: true });
  await advanceProductionPick({ db: bySku, userId: 7,
    rawText: 'Revisa materiales OP ID 110' });
  const lot = await advanceProductionPick({ db: bySku, userId: 7,
    rawText: 'cambiar lote de 00006-TRP' });
  assert.match(lot.message, /1\. Lote R8-260928-TRP/u);
  assert.equal(bySku.allocations[0].stock_id, 11);
});

test('un nombre o SKU con dos partidas pide aclaración y conserva reservas', async () => {
  for (const phrase of ['cambia el lote del tarro', 'cambia lote de 00006-TRP']) {
    const db = fakeDb({ extraTarroPart: true });
    await advanceProductionPick({ db, userId: 7,
      rawText: 'Revisa materiales OP ID 110' });
    const reply = await advanceProductionPick({ db, userId: 7, rawText: phrase });
    assert.match(reply.message, /tiene 2 partidas/u, phrase);
    assert.match(reply.message, /partida N/u, phrase);
    assert.equal(db.allocations[0].stock_id, 11, phrase);
    assert.equal(db.allocations[2].stock_id, 13, phrase);
    assert.equal(db.stocks.get(11).reservada, 7, phrase);
  }
});

test('el lote o ubicación anterior desambigua dos partidas del mismo tarro', async () => {
  for (const phrase of [
    'corrige ubicación del tarro del lote R6-260925-TRP a A10',
    'corrige ubicación del tarro desde A9 a A10',
  ]) {
    const db = fakeDb({ extraTarroPart: true });
    await advanceProductionPick({ db, userId: 7,
      rawText: 'Revisa materiales OP ID 110' });
    const offered = await advanceProductionPick({ db, userId: 7, rawText: phrase });
    assert.match(offered.message, /Partida 3: TARRO CUADRADO/u, phrase);
    assert.equal(db.allocations[2].stock_id, 13, phrase);
    assert.equal(db.stocks.get(13).reservada, 2, phrase);
  }
});

test('dos SKU o un producto ajeno a la OP no seleccionan una partida por aproximación', async () => {
  for (const phrase of [
    'cambia ubicación de 00006-TRP y 00001-TPBI a A10',
    'cambia ubicación de etiqueta probióticos a A10',
  ]) {
    const db = fakeDb({ withEtiqueta: true });
    await advanceProductionPick({ db, userId: 7,
      rawText: 'Revisa materiales OP ID 110' });
    const reply = await advanceProductionPick({ db, userId: 7, rawText: phrase });
    assert.match(reply.message, /no cambié las reservas/iu, phrase);
    assert.equal(db.allocations[0].stock_id, 11, phrase);
    assert.equal(db.allocations[1].stock_id, 21, phrase);
    assert.equal(db.allocations[2].stock_id, 31, phrase);
  }
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

test('una partida con destino claro no necesita la palabra corrección ni ubicación', async () => {
  for (const phrase of ['partida 1 va para la A10', 'fila 1 queda en A10',
    'partida 1 lo dejo en la A10']) {
    const db = fakeDb();
    await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
    const offered = await advanceProductionPick({ db, userId: 7, rawText: phrase });
    assert.match(offered.message, /elige el lote/u, phrase);
    assert.equal(db.allocations[0].ubicacion, 'A11', phrase);
    const chosen = await advanceProductionPick({ db, userId: 7, rawText: 'opción 1' });
    assert.match(chosen.message, /Corrección aplicada a la partida 1/u, phrase);
    assert.equal(db.allocations[0].ubicacion, 'A10', phrase);
  }
});

test('un destino sin partida no adivina entre materiales distintos', async () => {
  const db = fakeDb();
  await advanceProductionPick({ db, userId: 7, rawText: 'Revisa materiales OP ID 110' });
  const reply = await advanceProductionPick({ db, userId: 7, rawText: 'va para la A10' });
  assert.match(reply.message, /No identifiqué una sola partida/u);
  assert.equal(db.allocations[0].ubicacion, 'A11');
  assert.equal(db.allocations[1].ubicacion, 'A8');
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
