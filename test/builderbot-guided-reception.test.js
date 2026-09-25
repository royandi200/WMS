const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { advanceGuidedReception, hasPendingSkuReview, skuReviewReply } = require('../api/_lib/builderbot-guided-reception');
const { canonicalJson } = require('../api/_lib/builderbot-reception');

function guidedDb({ singleSku = null } = {}) {
  const products = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO (60 UNID)', alias: 'tapa' },
    { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
    { id: 276, siigo_code: '00276-PTZNASHWA', nombre: 'PRODUCTO TERMINADO ZENOVA ASHWAGANDHA', alias: 'Zenova Ashwagandha' },
  ];
  const state = { draft: null, recentLog: [], inventoryWrites: 0, transactions: 0 };
  const db = {
    async beginTransaction() { state.transactions += 1; },
    async commit() { state.transactions -= 1; },
    async rollback() { state.transactions -= 1; },
    async execute(sql, values = []) {
      if (/INSERT INTO (?:kardex|inventario)|UPDATE (?:inventario|stock)/u.test(sql)) {
        state.inventoryWrites += 1;
        throw new Error('A guided draft must not affect inventory');
      }
      if (/FROM ordenes_compra_proveedor oc WHERE oc\.id/u.test(sql)) {
        return [[{ id: 37, numero: 'OC-37', estado: 'CARGADA', tipo_recepcion: 'INSUMOS_MP' }]];
      }
      if (/FROM webhook_logs/u.test(sql)) return [state.recentLog];
      if (/FROM recepciones\s+WHERE id = \? AND orden_compra_id = \?/u.test(sql)) {
        return [values[0] === 101 && values[1] === 37
          ? [{ recepcion_id: 101, orden_compra_id: 37 }] : []];
      }
      if (/FROM recepciones\s+WHERE orden_compra_id = \? AND estado = 'completada'/u.test(sql)) return [[]];
      if (/FROM ordenes_compra_proveedor\s+WHERE id = \? LIMIT 1 FOR UPDATE/u.test(sql)) {
        return [[{ id: 37, numero: 'OC-37', estado: 'CARGADA' }]];
      }
      if (/FROM recepciones\s+WHERE preparacion_clave/u.test(sql)) {
        return [[{ id: 101, numero: 'REC-OC-37-001', orden_compra_id: 37,
          estado: 'borrador', bodega_id: 1 }]];
      }
      if (/FROM recepcion_items ri/u.test(sql)) {
        const items = [
          { item_id: 1, producto_id: 19, sku: '00001-TPBI', producto: products[0].nombre,
            cantidad_pendiente: 2, unidad: 'und', lote_documento: 'T-1',
            fecha_vencimiento_documento: '2027-12-31' },
          { item_id: 2, producto_id: 60, sku: '00051-MPASH', producto: products[1].nombre,
            cantidad_pendiente: 100, unidad: 'g', lote_documento: 'G-1',
            fecha_vencimiento_documento: '2027-12-31' },
          { item_id: 3, producto_id: 276, sku: '00276-PTZNASHWA', producto: products[2].nombre,
            cantidad_pendiente: 1, unidad: 'und', lote_documento: 'Z-1',
            fecha_vencimiento_documento: '2027-12-31' },
        ];
        return [singleSku ? items.filter(item => item.sku === singleSku) : items.slice(0, 2)];
      }
      if (/FROM producto_ubicaciones pu/u.test(sql)) return [[
        { producto_id: 19, prioridad: 1, tipo_asignacion: 'PRIMARIA',
          ubicacion_id: 8, ubicacion: 'A8' },
        { producto_id: 60, prioridad: 1, tipo_asignacion: 'PRIMARIA',
          ubicacion_id: 16, ubicacion: 'B16' },
      ]];
      if (/SELECT id FROM recepciones WHERE id = \? FOR UPDATE/u.test(sql)) return [[{ id: 101 }]];
      if (/FROM recepcion_confirmacion_borradores d/u.test(sql)) {
        return [state.draft ? [{ ...state.draft, recepcion_id: 101, orden_compra_id: 37 }] : []];
      }
      if (/FROM recepcion_confirmacion_borradores\s+WHERE recepcion_id/u.test(sql)) {
        return [state.draft ? [{ ...state.draft }] : []];
      }
      if (/INSERT INTO recepcion_confirmacion_borradores/u.test(sql)) {
        state.draft = { usuario_id: values[2], payload_json: values[3], payload_hash: values[4] };
        return [{ affectedRows: 1 }];
      }
      if (/FROM productos p/u.test(sql) && !/LEFT JOIN producto_aliases/u.test(sql)) {
        return [products.filter(product => product.siigo_code === values[1]
          && (!singleSku || product.siigo_code === singleSku))];
      }
      if (/FROM producto_aliases pa/u.test(sql)) return [[]];
      if (/LEFT JOIN producto_aliases/u.test(sql)) {
        return [products.filter(product => values.includes(product.id))];
      }
      if (/FROM ubicaciones/u.test(sql)) {
        return [[{ id: values[0] === 'A8' ? 8 : 16, codigo: values[0] }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { db, state };
}

test('guided OC reception accumulates audio-sized pieces and only creates a review draft', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({
    db, user, rawText, params: { avance },
  });
  const first = await send('Empiezo con etapa de OCID 37', { producto: 'etapa' });
  assert.match(first.message, /00001-TPBI/u);
  assert.match(first.message, /Interpreté «etapa»/u);
  assert.match(first.message, /Cantidad pendiente según OC: 2 und \(referencia; no es la cantidad recibida\)/u);
  assert.match(first.message, /Indica cuántas unidades recibiste \(und\)/u);
  assert.match(first.message, /Falta: cantidad, condición, ubicación/u);
  assert.match(first.message, /Lote propuesto por PDF: T-1/u);
  assert.match(first.message, /Ubicación sugerida: A8/u);
  const quantity = await send('Llegaron dos', { cantidad: 2 });
  assert.match(quantity.message, /Cantidad registrada: 2 und/u);
  assert.doesNotMatch(quantity.message, /Indica cuántas unidades recibiste/u);
  assert.match(quantity.message, /Falta: condición, ubicación/u);
  await send('Están disponibles', { condicion: 'DISPONIBLE' });
  const review = await send('En la ubicación A8', { ubicacion: 'A8' });
  assert.equal(review.sku_review, true);
  assert.match(review.message, /Cantidad recibida: 2 und/u);
  assert.match(review.message, /Ubicación sugerida: A8/u);
  assert.match(review.message, /¿Está correcto este SKU\?/u);
  assert.equal(JSON.parse(state.draft.payload_json).reviewSku, '00001-TPBI');
  const next = await send('sí', {});
  assert.match(next.message, /00051-MPASH/u);
  const secondReview = await send('De gomas, cien gramos disponibles en B16', {
    producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16',
  });
  assert.equal(secondReview.sku_review, true);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  const preview = await send('sí', {});
  assert.equal(preview.requires_confirmation, true);
  assert.match(preview.message, /Confirmo la recepción OC ID 37/u);
  assert.match(preview.message, /propuesto por PDF/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.equal(state.inventoryWrites, 0);
  assert.equal(state.transactions, 0);
});

test('selecting a gram-based SKU shows expected grams and asks for actual grams', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas, dos disponibles en A8', {
    producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  await send('sí', {});
  const grams = await send('Empecemos con las gomas', { producto: 'gomas' });
  assert.match(grams.message, /Cantidad pendiente según OC: 100 g \(referencia; no es la cantidad recibida\)/u);
  assert.match(grams.message, /Indica cuántos gramos recibiste \(g\)/u);
  assert.match(grams.message, /Falta: cantidad, condición, ubicación/u);
  assert.equal(state.inventoryWrites, 0);
});

test('a PDF lot mismatch requires the physical lot before verifying the SKU', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas, dos disponibles en A8', {
    producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  const mismatch = await send('el lote no coincide', { motivo: 'lote no coincide' });
  assert.match(mismatch.message, /Falta: lote físico correcto/u);
  assert.match(mismatch.message, /Lote propuesto por PDF: T-1 \(no coincide/u);
  assert.doesNotMatch(mismatch.message, /Motivo de condición: lote no coincide/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].lote_discrepa_pdf, true);
  const premature = await send('sí', {});
  assert.match(premature.message, /Falta: lote físico correcto/u);
  const corrected = await send('El lote de la etiqueta es T-2', { lote: 'T-2' });
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Lote: T-2\./u);
  assert.doesNotMatch(corrected.message, /Lote: T-1/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].lote_discrepa_pdf, false);
  assert.equal(state.inventoryWrites, 0);
});

test('a PDF expiry mismatch requires a corrected date and shows saved progress', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas, dos disponibles en A8', {
    producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  const mismatch = await send('la fecha de vencimiento no coincide', {});
  assert.match(mismatch.message, /Cantidad registrada: 2 und/u);
  assert.match(mismatch.message, /Ubicación sugerida: A8/u);
  assert.match(mismatch.message, /Falta: vencimiento físico correcto/u);
  const corrected = await send('Vence el 30 de noviembre de 2027', {
    fecha_vencimiento: '2027-11-30',
  });
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Vencimiento: 2027-11-30\./u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].vencimiento_discrepa_pdf, false);
  assert.equal(state.inventoryWrites, 0);
});

test('guided OC reception refuses to infer a new order from model memory alone', async () => {
  const { db, state } = guidedDb();
  await assert.rejects(
    advanceGuidedReception({ db, user: { id: 5 }, rawText: 'Empecemos con las tapas',
      params: { orden_compra_id: 37, avance: { producto: 'tapas' } } }),
    error => error.status === 409 && /OC ID N/u.test(error.message)
  );
  assert.equal(state.draft, null);
});

test('first product follows the last prepared reception without repeating OC ID', async () => {
  const { db, state } = guidedDb();
  state.recentLog = [{ action: 'PREPARAR_RECEPCION_OC', response: JSON.stringify({
    context: { reception: { reception_id: 101, purchase_order_id: 37,
      inventory_changed: false } },
  }) }];
  const first = await advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'Empezaremos con tapa tarro cuadrado blanco por 60',
    params: { avance: { producto: 'tapa tarro cuadrado blanco por 60' } },
  });
  assert.match(first.message, /00001-TPBI/u);
  assert.match(first.message, /Falta: cantidad, condición, ubicación/u);
  assert.equal(JSON.parse(state.draft.payload_json).orderId, 37);
  assert.equal(state.inventoryWrites, 0);
  state.recentLog = [{ action: 'CONSULTAR_STOCK_MATERIA_PRIMA', response: '{}' }];
  const next = await advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'Llegaron dos', params: { avance: { cantidad: 2 } },
  });
  assert.match(next.message, /Falta: condición, ubicación/u);
});

test('a stale or unrelated preparation cannot select an order from model memory', async () => {
  const { db, state } = guidedDb();
  state.recentLog = [{ action: 'CONSULTAR_STOCK_MATERIA_PRIMA', response: '{}' },
    { action: 'PREPARAR_RECEPCION_OC', response: JSON.stringify({
      context: { reception: { reception_id: 101, purchase_order_id: 37,
        inventory_changed: false } },
    }) }];
  await assert.rejects(advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'Empecemos con las tapas', params: { orden_compra_id: 37,
      avance: { producto: 'tapas' } },
  }), /Para empezar, indica OC ID N o IO ID N/u);
  assert.equal(state.inventoryWrites, 0);
});

test('guided OC reception never reassigns an active draft to another operator', async () => {
  const { db } = guidedDb();
  await advanceGuidedReception({ db, user: { id: 5 }, rawText: 'OC ID 37',
    params: { avance: { producto: 'tapa' } } });
  await assert.rejects(
    advanceGuidedReception({ db, user: { id: 6 }, rawText: 'OC ID 37',
      params: { avance: { producto: 'tapa' } } }),
    error => error.status === 409 && /otro usuario/u.test(error.message)
  );
});

test('guided OC reception asks why a partial quantity differs from the order', async () => {
  const { db, state } = guidedDb();
  const response = await advanceGuidedReception({ db, user: { id: 5 },
    rawText: 'OC ID 37: llegó una tapa disponible en A8',
    params: { avance: { producto: 'tapa', cantidad: 1, condicion: 'DISPONIBLE', ubicacion: 'A8' } },
  });
  assert.match(response.message, /motivo de la diferencia frente a la OC/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  const premature = await advanceGuidedReception({ db, user: { id: 5 }, rawText: 'sí',
    params: { avance: {} } });
  assert.match(premature.message, /motivo de la diferencia frente a la OC/u);
  assert.notEqual(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(state.inventoryWrites, 0);
});

test('guided OC reception can correct its own preview without confirming inventory', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37',
    params: { avance: { producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' } },
  });
  await advanceGuidedReception({ db, user, rawText: 'sí', params: { avance: {} } });
  await advanceGuidedReception({ db, user, rawText: 'Gomas, cien disponibles en B16',
    params: { avance: { producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16' } },
  });
  await advanceGuidedReception({ db, user, rawText: 'sí', params: { avance: {} } });
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  const corrected = await advanceGuidedReception({ db, user,
    rawText: 'Corrige las tapas: recibí una, faltó otra',
    params: { correccion: true, avance: { producto: 'tapa', cantidad: 1,
      motivo_diferencia: 'Faltó una unidad' } },
  });
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Cantidad recibida: 1 und/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  const preview = await advanceGuidedReception({ db, user, rawText: 'sí', params: { avance: {} } });
  assert.equal(preview.requires_confirmation, true);
  assert.match(preview.message, /00001-TPBI[^\n]*\n  Recibido: 1 und/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.equal(state.inventoryWrites, 0);
});

test('final summary accepts a spoken location correction without repeating OC ID or model correction flag', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas, dos disponibles en A8', {
    producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  await send('sí', {});
  await send('Gomas, cien disponibles en B16', {
    producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16',
  });
  await send('sí', {});
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);

  const corrected = await send('Corrección ubicación de tapas A1', { ubicacion: 'A1' });
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Ubicación registrada: A1/u);
  assert.match(corrected.message, /¿Está correcto este SKU\?/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, false);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00051-MPASH'].verified, true);
  const reviewed = await send('sí', {});
  assert.equal(reviewed.requires_confirmation, true);
  assert.match(reviewed.message, /00001-TPBI[\s\S]*Ubicación: A1/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.equal(state.inventoryWrites, 0);
});

test('a single pending SKU keeps context through final-summary corrections and difficult speech aliases', async () => {
  const { db, state } = guidedDb({ singleSku: '00276-PTZNASHWA' });
  const user = { id: 5 };
  const send = (rawText, avance = {}) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  const selected = await send('OC ID 37: registremos Sinova Ashawanda',
    { producto: 'Sinova Ashawanda' });
  assert.match(selected.message, /00276-PTZNASHWA/u);
  assert.match(selected.message, /Interpreté «Sinova Ashawanda»/u);
  const review = await send('Llegó una unidad, estado bueno y ubicación B13',
    { cantidad: 1, condicion: 'DISPONIBLE', ubicacion: 'B13' });
  assert.equal(review.sku_review, true);
  await send('Sí');
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);

  const corrected = await send('Corrección ubicación B14');
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Ubicación registrada: B14/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00276-PTZNASHWA'].ubicacion, 'B14');
  const preview = await send('Sí');
  assert.equal(preview.requires_confirmation, true);
  assert.match(preview.message, /Ubicación: B14/u);
  assert.equal(state.inventoryWrites, 0);
});

test('guided reception joins a spoken section letter and location number without inventing a missing letter', async () => {
  const { db, state } = guidedDb({ singleSku: '00276-PTZNASHWA' });
  const user = { id: 5 };
  const review = await advanceGuidedReception({ db, user,
    rawText: 'OC ID 37: llegó una unidad, buena, ubicación b 13',
    params: { avance: { producto: '00276-PTZNASHWA', cantidad: 1,
      condicion: 'DISPONIBLE', ubicacion: 'b 13' } },
  });
  assert.equal(review.sku_review, true);
  assert.match(review.message, /Ubicación registrada: B13/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00276-PTZNASHWA'].ubicacion, 'B13');
  assert.equal(state.inventoryWrites, 0);
});

test('a single pending SKU does not turn an unrelated explicit product into that SKU', async () => {
  const { db, state } = guidedDb({ singleSku: '00276-PTZNASHWA' });
  await assert.rejects(advanceGuidedReception({ db, user: { id: 5 },
    rawText: 'OC ID 37: recibí tapas', params: { avance: { producto: 'tapas' } } }),
  /Producto "tapas" no encontrado/u);
  assert.equal(state.inventoryWrites, 0);
});

test('a generic correction opens the final preview and keeps context for a following SKU', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas, dos disponibles en A8', {
    producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  await send('sí', {});
  await send('Gomas, cien disponibles en B16', {
    producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16',
  });
  await send('sí', {});
  const ask = await send('Corrección del resumen', {});
  assert.match(ask.message, /Indica qué SKU o producto quieres corregir/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  const selected = await send('Las tapas', { producto: 'tapa' });
  assert.equal(selected.sku_review, true);
  assert.match(selected.message, /Ubicación registrada: A8/u);
  const corrected = await send('En A1', { ubicacion: 'A1' });
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Ubicación registrada: A1/u);
  assert.equal(state.inventoryWrites, 0);
});

test('an incorrect SKU is corrected and reviewed again before the next one', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas, dos disponibles en A8', {
    producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  const no = await send('no', {});
  assert.match(no.message, /Indica qué dato de 00001-TPBI debo corregir/u);
  const premature = await send('Ahora sigamos con las gomas', { producto: 'gomas' });
  assert.match(premature.message, /Antes de pasar a otro producto, revisa 00001-TPBI/u);
  const corrected = await send('No, llegó una tapa; faltó otra', {
    cantidad: 1, motivo_diferencia: 'Faltó una unidad',
  });
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Cantidad recibida: 1 und/u);
  assert.match(corrected.message, /Motivo de diferencia: Faltó una unidad/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, false);
  const next = await send('sí', {});
  assert.match(next.message, /00051-MPASH/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(state.inventoryWrites, 0);
});

test('a bare yes is scoped to a stored SKU review, not final inventory confirmation', async () => {
  const { db, state } = guidedDb();
  assert.equal(skuReviewReply('Sí.'), 'YES');
  assert.equal(skuReviewReply('Sí, todo está bien'), 'YES');
  assert.equal(skuReviewReply('No'), 'NO');
  assert.equal(skuReviewReply('No está bien'), 'NO');
  assert.equal(skuReviewReply('Sí, pero cambia la cantidad'), null);
  assert.equal(skuReviewReply('Confirmo la recepción OC ID 37'), null);
  const echoedYes = 'Sí\n{name}="Juan Esteban"\n[Friday, September 25, 2026 12:16:03]: Sí';
  assert.equal(skuReviewReply(echoedYes), 'YES');
  assert.equal(skuReviewReply('{name}="Juan Esteban"\n[Friday, September 25, 2026 12:19:21]: Si'), 'YES');
  assert.equal(skuReviewReply('{name}="Juan Esteban"\n[Friday, September 25, 2026 12:19:21]: Sí, cambia lote'), null);
  assert.equal(skuReviewReply('Sí\n{name}="Juan Esteban"\n[Friday, September 25, 2026 12:16:03]: No'), null);
  assert.equal(skuReviewReply('Sí\nOtro dato de la recepción'), null);
  assert.equal(await hasPendingSkuReview(db, 5), false);
  await advanceGuidedReception({ db, user: { id: 5 }, rawText: 'OC ID 37',
    params: { avance: { producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  assert.equal(await hasPendingSkuReview(db, 5), true);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  assert.equal(state.inventoryWrites, 0);
});

test('BuilderBot history echo does not block a reviewed SKU yes', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
    params: { avance: { producto: 'tapa', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const accepted = await advanceGuidedReception({ db, user,
    rawText: 'sí\n{name}="Juan Esteban"\n[Friday, September 25, 2026 12:05:47]:  sí',
    params: { avance: {} } });
  assert.match(accepted.message, /00001-TPBI quedó revisado en el borrador/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(state.inventoryWrites, 0);
});

test('BuilderBot tagged-only written yes advances only the reviewed SKU', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
    params: { avance: { producto: 'tapa', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const accepted = await advanceGuidedReception({ db, user,
    rawText: '{name}="Juan Esteban"\n[Friday, September 25, 2026 12:19:21]: Si',
    params: { avance: {} } });
  assert.match(accepted.message, /00001-TPBI quedó revisado en el borrador/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(state.inventoryWrites, 0);
});

test('an in-progress draft from before this change stops for its first SKU review', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: tapas, dos disponibles en A8',
    params: { avance: { producto: 'tapa', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const old = JSON.parse(state.draft.payload_json);
  delete old.reviewSku;
  delete old.entries['00001-TPBI'].verified;
  old.selectedSku = null;
  state.draft.payload_json = canonicalJson(old);
  state.draft.payload_hash = createHash('sha256').update(state.draft.payload_json).digest('hex');
  assert.equal(await hasPendingSkuReview(db, 5), true);
  const resumed = await advanceGuidedReception({ db, user, rawText: 'Sigamos con las gomas',
    params: { avance: { producto: 'gomas' } } });
  assert.equal(resumed.sku_review, true);
  assert.match(resumed.message, /Producto: 00001-TPBI/u);
  assert.equal(JSON.parse(state.draft.payload_json).reviewSku, '00001-TPBI');
  assert.equal(state.inventoryWrites, 0);
});
