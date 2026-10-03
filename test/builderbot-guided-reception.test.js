const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { advanceGuidedReception, hasPendingSkuReview, hasRecentReceptionContext,
  guidedReceptionResume, isReceptionCorrectionRequest, skuReviewReply } = require('../api/_lib/builderbot-guided-reception');
const { canonicalJson } = require('../api/_lib/builderbot-reception');

const batchTranscription = 'Voy a ingresar tapa de tarro cuadrado blanco, las 30 unidades en la ubicación A8 y están en buen estado. También voy a ingresar las etiquetas achaguanda por 60, las 30 unidades, están en buen estado en A11. Voy a ingresar el liner tarro por 60, 30 unidades, hay 20 en buen estado y 10 en mal estado que van para cuarentena. y las 20 las voy a guardar en B10 y las gomas achaguanda de magnesio y vitamina C están los 5400 gramos en buen estado y los voy a guardar en A10';
const batchAdvances = () => [
  { producto: 'tapa de tarro cuadrado blanco', cantidad: 30, condicion: 'DISPONIBLE', ubicacion: 'A8' },
  { producto: 'etiquetas achaguanda por 60', cantidad: 30, condicion: 'DISPONIBLE', ubicacion: 'A11' },
  { producto: 'liner tarro por 60', cantidad_total: 30, partidas: [
    { cantidad: 20, condicion: 'DISPONIBLE', ubicacion: 'B10' },
    { cantidad: 10, condicion: 'CUARENTENA' },
  ] },
  { producto: 'gomas achaguanda de magnesio y vitamina C', cantidad: 5400,
    condicion: 'DISPONIBLE', ubicacion: 'A10' },
];

function guidedDb({ singleSku = null, batchProducts = false } = {}) {
  const products = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO (60 UNID)', alias: 'tapa' },
    { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
    { id: 276, siigo_code: '00276-PTZNASHWA', nombre: 'PRODUCTO TERMINADO ZENOVA ASHWAGANDHA', alias: 'Zenova Ashwagandha' },
  ];
  if (batchProducts) products.push(
    { id: 17, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA x 60', alias: 'etiquetas' },
    { id: 35, siigo_code: '00035-LNTP60', nombre: 'LINER TARRO x 60', alias: 'liner' },
    { id: 6, siigo_code: '00006-TRP', nombre: 'TARRO', alias: 'tarros' },
  );
  if (batchProducts) products[1].nombre = 'GOMAS ASHWAGANDHA -MAGNESIO Y VITAMINA C';
  const state = { draft: null, extraDrafts: [], recentLog: [], inventoryWrites: 0, transactions: 0 };
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
        if (batchProducts) return [[
          ...items.slice(0, 2).map(item => ({ ...item,
            cantidad_pendiente: item.sku === '00051-MPASH' ? 5400 : 30 })),
          ...products.slice(3).map(product => ({ item_id: product.id, producto_id: product.id,
            sku: product.siigo_code, producto: product.nombre, cantidad_pendiente: 30,
            unidad: 'und', lote_documento: `L-${product.id}`, fecha_vencimiento_documento: '2027-12-31' })),
        ]];
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
        return [[...state.extraDrafts, ...(state.draft ? [{ ...state.draft, recepcion_id: 101,
          orden_compra_id: 37, reception_number: 'REC-OC-37-001' }] : [])]
          .filter(row => Number(row.usuario_id) === Number(values[0]))];
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

test('batch captures the complete transcription without mixing SKUs or discarding incomplete partitions', async () => {
  const { db, state } = guidedDb({ batchProducts: true });
  const user = { id: 5 };
  const send = (rawText, params) => advanceGuidedReception({ db, user, rawText, params });
  await send('OC ID 37: tarros 30 disponibles en A11', {
    avance: { producto: 'tarros', cantidad: 30, condicion: 'DISPONIBLE', ubicacion: 'A11' },
  });
  await send('sí', { avance: {} });
  const result = await send(batchTranscription, { avances: batchAdvances() });
  assert.equal(result.batch_captured, 4);
  assert.match(result.message, /ubicación de partida 2/u);
  assert.match(result.message, /motivo de partida 2 \(CUARENTENA\)/u);
  const draft = JSON.parse(state.draft.payload_json);
  assert.equal(draft.selectedSku, '00035-LNTP60');
  assert.equal(draft.entries['00006-TRP'].verified, true);
  assert.equal(draft.entries['00001-TPBI'].ubicacion, 'A8');
  assert.equal(draft.entries['00017-ETASH60'].ubicacion, 'A11');
  assert.equal(draft.entries['00051-MPASH'].ubicacion, 'A10');
  assert.equal(draft.entries['00051-MPASH'].cantidad, 5400);
  assert.equal(draft.entries['00035-LNTP60'].cantidad, 30);
  assert.deepEqual(draft.entries['00035-LNTP60'].partidas.map(part => [part.cantidad,
    part.condicion, part.ubicacion, part.motivo || null]), [
    [20, 'DISPONIBLE', 'B10', null], [10, 'CUARENTENA', null, null],
  ]);
  for (const sku of ['00001-TPBI', '00017-ETASH60', '00035-LNTP60', '00051-MPASH']) {
    assert.equal(draft.entries[sku].verified, false);
  }
  // Completing the missing partition must not be intercepted by another
  // complete SKU awaiting review; all other batch data remain persisted.
  const liner = await send('partida 2 en Q1 por empaque roto', {
    avance: { partida: 2, ubicacion: 'Q1', motivo: 'empaque roto' },
  });
  assert.equal(liner.sku_review, true);
  assert.match(liner.message, /Partida 2: 10 und · CUARENTENA · ubicación Q1/u);
  assert.match(liner.message, /Motivo: empaque roto/u);
  let review = await send('sí', { avance: {} });
  assert.match(review.message, /Producto: 00001-TPBI/u);
  review = await send('sí', { avance: {} });
  assert.match(review.message, /Producto: 00051-MPASH/u);
  review = await send('sí', { avance: {} });
  assert.match(review.message, /Producto: 00017-ETASH60/u);
  const preview = await send('sí', { avance: {} });
  assert.equal(preview.requires_confirmation, true);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.match(preview.message, /Confirmo la recepción OC ID 37/u);
  assert.match(preview.message, /CUARENTENA/u);
  assert.equal(state.inventoryWrites, 0);
  assert.equal(state.transactions, 0);
});

test('batch can capture other products while a SKU awaits review, without verifying that SKU', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: tapas dos en A8 buenas',
    params: { avance: { producto: 'tapas', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const result = await advanceGuidedReception({ db, user, rawText: 'gomas 100 g en B16 buenas',
    params: { avances: [{ producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16' }] } });
  assert.match(result.message, /Producto: 00001-TPBI/u);
  const draft = JSON.parse(state.draft.payload_json);
  assert.equal(draft.entries['00001-TPBI'].verified, false);
  assert.equal(draft.entries['00051-MPASH'].cantidad, 100);
  assert.equal(draft.entries['00051-MPASH'].verified, false);
  assert.equal(state.inventoryWrites, 0);
});

test('batch rejects foreign and duplicate products atomically, and keeps user draft ownership', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (avances, actor = user) => advanceGuidedReception({ db, user: actor,
    rawText: 'OC ID 37: ingreso conjunto', params: { avances } });
  const tapa = { producto: 'tapas', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' };
  await assert.rejects(send([tapa, { producto: 'otro producto' }]), /no encontrado/u);
  assert.equal(state.draft, null);
  await assert.rejects(send([tapa, { ...tapa, producto: '00001-TPBI' }]), /sin repetir el SKU/u);
  assert.equal(state.draft, null);
  await assert.rejects(send([tapa, { producto: 'gomas', cantidad: -10 }]), /cantidad positiva/u);
  assert.equal(state.draft, null);
  await send([tapa]);
  const before = state.draft.payload_json;
  await assert.rejects(send([tapa], { id: 8 }), /otro usuario/u);
  assert.equal(state.draft.payload_json, before);
  assert.equal(state.inventoryWrites, 0);
  assert.equal(state.transactions, 0);
});

test('batch rejects invalid structure, mixed contracts, excessive length and final confirmation', async () => {
  const { db, state } = guidedDb();
  for (const params of [
    { avances: [] }, { avances: {} }, { avances: Array(101).fill({ producto: 'tapas' }) },
    { avances: [{ producto: 'tapas' }], avance: {} }, { avances: [{}] },
    { avances: [{ producto: 'tapas', verified: true }] },
    { avances: [{ producto: 'tapas' }], confirmacion_final: true },
  ]) {
    await assert.rejects(advanceGuidedReception({ db, user: { id: 5 },
      rawText: 'OC ID 37', params }));
  }
  assert.equal(state.draft, null);
  assert.equal(state.inventoryWrites, 0);
});

test('final preview supports batch corrections without losing untouched fields', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, params) => advanceGuidedReception({ db, user, rawText, params });
  await send('OC ID 37: dos tapas en A8 y 100 g de gomas en B16 disponibles', {
    avances: [
      { producto: 'tapas', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' },
      { producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16' },
    ],
  });
  await send('sí', { avance: {} });
  await send('sí', { avance: {} });
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  await send('Corrección: tapas en A1 y gomas en A10', {
    correccion: true, avances: [{ producto: 'tapas', ubicacion: 'A1' }, { producto: 'gomas', ubicacion: 'A10' }],
  });
  const draft = JSON.parse(state.draft.payload_json);
  assert.equal(draft.version, 2);
  assert.equal(draft.entries['00001-TPBI'].cantidad, 2);
  assert.equal(draft.entries['00001-TPBI'].ubicacion, 'A1');
  assert.equal(draft.entries['00001-TPBI'].lote, 'T-1');
  assert.equal(draft.entries['00051-MPASH'].cantidad, 100);
  assert.equal(draft.entries['00051-MPASH'].ubicacion, 'A10');
  assert.equal(draft.entries['00051-MPASH'].lote, 'G-1');
  assert.equal(draft.entries['00051-MPASH'].verified, false);
  assert.equal(state.inventoryWrites, 0);
});

test('prompt batch example uses the same contract and leaves quarantine location and cause missing', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  const example = prompt.match(/Ejemplo batch del mensaje actual:[^\n]*-> `params: (\{[^\n]+\})`/u);
  assert.ok(example);
  const { avances } = JSON.parse(example[1]);
  assert.deepEqual(avances, batchAdvances());
  assert.match(prompt, /solamente lo dicho en el mensaje actual/u);
  assert.match(prompt, /mal estado` NO es una causa concreta/u);
  assert.match(prompt, /no cambies a `CONFIRMAR_RECEPCION_OC` porque falten datos/u);
});

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

async function twoDraftReviews() {
  const fixture = guidedDb();
  const { db, state } = fixture;
  const review = await advanceGuidedReception({ db, user: { id: 5 }, rawText: 'OC ID 37',
    params: { avance: { producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const otherPayload = { ...JSON.parse(state.draft.payload_json), orderId: 44, receptionId: 132 };
  state.extraDrafts = [{ usuario_id: 5, recepcion_id: 132, orden_compra_id: 44,
    reception_number: 'REC-OC-44-001', payload_json: JSON.stringify(otherPayload),
    payload_hash: createHash('sha256').update(canonicalJson(otherPayload)).digest('hex') }];
  // The unrelated draft appears first: timestamps must not choose the order.
  state.recentLog = [{ action: 'AVANZAR_RECEPCION_GUIADA_OC', response: JSON.stringify({
    message: review.message, context: { reception: review },
  }) }];
  return { ...fixture, review };
}

test('yes uses the last chat SKU review with two active receipts, not a model ID', async () => {
  const { db, state } = await twoDraftReviews();
  const other = JSON.stringify(state.extraDrafts);
  assert.equal(await hasPendingSkuReview(db, 5, '573150000059'), true);
  const result = await advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'sí', params: { orden_compra_id: 44, avance: {} } });
  assert.equal(result.reception_id, 101);
  assert.equal(result.purchase_order_id, 37);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(JSON.stringify(state.extraDrafts), other);
  assert.equal(state.inventoryWrites, 0);
});

test('a review already shown before structured context can be resumed with yes', async () => {
  const { db, state, review } = await twoDraftReviews();
  state.recentLog[0].response = JSON.stringify({ mensaje: review.message,
    context: { reception: { guided: true, sku_review: true, inventory_changed: false } } });
  const result = await advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'sí', params: { avance: {} } });
  assert.match(result.message, /00001-TPBI - TAPA TARRO CUADRADO BLANCO \(60 UNID\) quedó revisado/u);
  assert.equal(state.inventoryWrites, 0);
});

test('corrections stay in the last displayed receipt with another draft open', async () => {
  const { db, state } = await twoDraftReviews();
  const result = await advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'Corrección ubicación A11', params: { avance: {} } });
  assert.equal(result.purchase_order_id, 37);
  assert.equal(result.review_sku, '00001-TPBI');
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].ubicacion, 'A11');
  assert.equal(JSON.parse(state.extraDrafts[0].payload_json).entries['00001-TPBI'].ubicacion, 'A8');
});

test('multiple drafts remain ambiguous without a valid last reply for this chat', async () => {
  for (const variant of ['no-phone', 'expired-context', 'unrelated', 'missing-draft',
    'different-order', 'completed', 'inventory-change', 'changed-sku', 'invalid-json', 'legacy-wrong-number', 'legacy-wrong-sku']) {
    const { db, state, review } = await twoDraftReviews();
    const context = { ...review };
    if (variant === 'expired-context') state.recentLog = [];
    if (variant === 'unrelated') state.recentLog.unshift({ action: 'CONSULTAR_STOCK', response: '{}' });
    if (variant === 'missing-draft') context.reception_id = 999;
    if (variant === 'different-order') context.purchase_order_id = 44;
    if (variant === 'completed') context.already_completed = true;
    if (variant === 'inventory-change') context.inventory_changed = true;
    if (variant === 'changed-sku') context.review_sku = '00051-MPASH';
    if (!['expired-context', 'unrelated'].includes(variant)) {
      state.recentLog[0].response = JSON.stringify({ message: review.message,
        context: { reception: context } });
    }
    if (variant === 'invalid-json') state.recentLog[0].response = 'not JSON';
    if (variant.startsWith('legacy-')) state.recentLog[0].response = JSON.stringify({
      message: variant === 'legacy-wrong-number' ? review.message.replace('REC-OC-37-001', 'REC-OC-37-002')
        : review.message.replace('Producto: 00001-TPBI', 'Producto: 00051-MPASH'),
      context: { reception: { sku_review: true, inventory_changed: false } },
    });
    const before = state.draft.payload_json;
    await assert.rejects(advanceGuidedReception({ db, user: { id: 5 },
      from: variant === 'no-phone' ? undefined : '573150000059', rawText: 'sí', params: { avance: {} } }),
    /Hay varias recepciones guiadas abiertas/u, variant);
    assert.equal(state.draft.payload_json, before, variant);
    assert.equal(state.inventoryWrites, 0, variant);
  }
});

test('recent chat context cannot claim another operator receipt draft', async () => {
  const { db, state, review } = await twoDraftReviews();
  const otherPayload = { ...JSON.parse(state.extraDrafts[0].payload_json), orderId: 45, receptionId: 133 };
  state.extraDrafts.push({ usuario_id: 6, recepcion_id: 133, orden_compra_id: 45,
    payload_json: JSON.stringify(otherPayload),
    payload_hash: createHash('sha256').update(canonicalJson(otherPayload)).digest('hex') });
  state.recentLog[0].response = JSON.stringify({ context: { reception: {
    ...review, reception_id: 133, purchase_order_id: 45,
  } } });
  await assert.rejects(hasPendingSkuReview(db, 5, '573150000059'), /Hay varias/u);
  assert.equal(state.inventoryWrites, 0);
});

test('transport duplicates do not hide the last SKU review', async () => {
  const { db, state } = await twoDraftReviews();
  state.recentLog.unshift({ action: 'AVANZAR_RECEPCION_GUIADA_OC',
    response: JSON.stringify({ duplicate: true }) });
  assert.equal(await hasPendingSkuReview(db, 5, '573150000059'), true);
});

test('a final summary correction resolves its receipt, never confirms inventory with yes', async () => {
  const { db, state } = await twoDraftReviews();
  const user = { id: 5 };
  const from = '573150000059';
  const send = async (rawText, params) => {
    const result = await advanceGuidedReception({ db, user, from, rawText, params });
    state.recentLog = [{ action: 'AVANZAR_RECEPCION_GUIADA_OC',
      response: JSON.stringify({ message: result.message, context: { reception: result } }) }];
    return result;
  };
  await send('sí', { avance: {} });
  await send('gomas, cien disponibles en B16', {
    avance: { producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16' },
  });
  const preview = await send('sí', { avance: {} });
  assert.equal(preview.requires_confirmation, true);
  assert.equal(preview.review_sku, null);
  assert.equal(await hasPendingSkuReview(db, 5, from), false);
  const repeated = await send('sí', { avance: {} });
  assert.equal(repeated.requires_confirmation, true);
  assert.equal(repeated.reception_id, 101);
  const corrected = await send('Corrección ubicación de tapas A11', { avance: {} });
  assert.equal(corrected.reception_id, 101);
  assert.equal(corrected.review_sku, '00001-TPBI');
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].ubicacion, 'A11');
  const updatedPreview = await send('sí', { avance: {} });
  assert.equal(updatedPreview.requires_confirmation, true);
  assert.equal(state.inventoryWrites, 0);
});

test('explicit current-message order overrides the last chat review', async () => {
  const { db, state, review } = await twoDraftReviews();
  state.recentLog[0].response = JSON.stringify({ context: { reception: { ...review,
    reception_id: 132, purchase_order_id: 44 } } });
  const result = await advanceGuidedReception({ db, user: { id: 5 }, from: '573150000059',
    rawText: 'OC ID 37: sí', params: { avance: {} } });
  assert.equal(result.reception_id, 101);
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

test('guided overage explains blocked units and an indexed correction recalculates the total', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  const reviewed = await advanceGuidedReception({ db, user,
    rawText: 'OC ID 37: llegaron tres tapas en dos partidas',
    params: { avance: { producto: 'tapa', cantidad_total: 3,
      motivo_diferencia: 'error del proveedor', partidas: [
        { cantidad: 1, condicion: 'DISPONIBLE', ubicacion: 'A8' },
        { cantidad: 2, condicion: 'CUARENTENA', ubicacion: 'A4', motivo: 'mal estado' },
      ] } },
  });
  assert.match(reviewed.message, /Sobrante frente a la OC: 1 und/u);
  assert.match(reviewed.message, /1 und quedarían disponibles y 2 und quedarían bloqueados/u);
  assert.match(reviewed.message, /cantidad de la partida 2 es 4/u);
  const corrected = await advanceGuidedReception({ db, user,
    rawText: 'Corrección, cantidad de la partida 2 es 1',
    params: { avance: { partida: 2, cantidad: 1, correccion: true } },
  });
  assert.match(corrected.message, /Total recibido: 2 und/u);
  assert.doesNotMatch(corrected.message, /Sobrante frente a la OC/u);
  const entry = JSON.parse(state.draft.payload_json).entries['00001-TPBI'];
  assert.equal(entry.cantidad, 2);
  assert.equal(entry.partidas[1].cantidad, 1);
  assert.equal(entry.motivo_diferencia, null);
  const revised = await advanceGuidedReception({ db, user,
    rawText: 'Corrección, el total recibido fue tres, partida uno una y partida dos dos',
    params: { avance: { correccion: true, cantidad_total: 3,
      motivo_diferencia: 'error del proveedor', partidas: [
        { partida: 1, cantidad: 1 }, { partida: 2, cantidad: 2 },
      ] } },
  });
  assert.match(revised.message, /Sobrante frente a la OC: 1 und/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].partidas[1].ubicacion, 'A4');
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
  assert.equal(skuReviewReply('sim'), 'YES');
  assert.equal(skuReviewReply('sim.'), 'YES');
  assert.equal(skuReviewReply('Sí, todo está bien'), 'YES');
  for (const reply of ['sii', 'síííí', 'correcto', 'todo está bien', 'perfecto',
    'está perfecto', 'todo correcto', 'de acuerdo', 'ok']) {
    assert.equal(skuReviewReply(reply), 'YES', reply);
  }
  assert.equal(skuReviewReply('No'), 'NO');
  assert.equal(skuReviewReply('No está bien'), 'NO');
  assert.equal(skuReviewReply('Sí, pero cambia la cantidad'), null);
  assert.equal(skuReviewReply('similar'), null);
  assert.equal(skuReviewReply('sim, cambia la cantidad'), null);
  assert.equal(skuReviewReply('perfecto, pero cambia la ubicación'), null);
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

test('positive SKU replies only advance the draft and never confirm inventory', async () => {
  for (const reply of ['sim', 'siiii', 'correcto', 'todo está bien', 'perfecto']) {
    const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
    const user = { id: 5 };
    await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
      params: { avance: { producto: 'tapas', cantidad: 2,
        condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
    const accepted = await advanceGuidedReception({ db, user, rawText: reply,
      params: { avance: {} } });
    assert.equal(accepted.requires_confirmation, true, reply);
    assert.match(accepted.message, /Confirmo la recepción OC ID 37/u);
    assert.equal(state.inventoryWrites, 0, reply);
  }
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
  assert.match(accepted.message, /00001-TPBI - TAPA TARRO CUADRADO BLANCO \(60 UNID\) quedó revisado en el borrador/u);
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
  assert.match(accepted.message, /00001-TPBI - TAPA TARRO CUADRADO BLANCO \(60 UNID\) quedó revisado en el borrador/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(state.inventoryWrites, 0);
});

test('audio transcription sim reviews only the pending SKU and shows its product name', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
    params: { avance: { producto: 'tapa', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const accepted = await advanceGuidedReception({ db, user, rawText: 'sim',
    params: { avance: {} } });
  assert.match(accepted.message,
    /00001-TPBI - TAPA TARRO CUADRADO BLANCO \(60 UNID\) quedó revisado en el borrador/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].verified, true);
  assert.equal(accepted.requires_confirmation, undefined);
  assert.equal(state.inventoryWrites, 0);
});

test('guided reception keeps available and quarantine partitions of one SKU', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance = {}) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas', { producto: 'tapas' });
  const incomplete = await send('partidas de tapas: 1 disponible en A8; 1 en cuarentena en CUAR-C-1-01', {});
  assert.match(incomplete.message, /motivo de partida 2 \(CUARENTENA\)/u);
  const review = await send('partida 2, motivo empaque roto');
  assert.equal(review.sku_review, true);
  assert.match(review.message, /Partida 1: 1 und · DISPONIBLE · ubicación A8/u);
  assert.match(review.message, /Partida 2: 1 und · CUARENTENA · ubicación CUAR-C-1-01/u);
  assert.equal((review.message.match(/Lote del proveedor: T-1/gu) || []).length, 2);
  assert.match(review.message, /Lote interno de cuarentena: se generará al confirmar\. El lote del proveedor indicado arriba no cambia\./u);
  assert.match(review.message, /Motivo: empaque roto/u);
  const entry = JSON.parse(state.draft.payload_json).entries['00001-TPBI'];
  assert.equal(entry.partidas.length, 2);
  assert.equal(entry.cantidad, 2);
  assert.equal(state.inventoryWrites, 0);
  await send('sí');
  await send('gomas: 100 g disponibles en B16', {
    producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16',
  });
  const preview = await send('sí');
  assert.equal(preview.requires_confirmation, true);
  assert.match(preview.message, /Partida 1: 1 und/u);
  assert.match(preview.message, /Partida 2: 1 und/u);
  assert.match(preview.message, /CUARENTENA/u);
  assert.match(preview.message, /Lote interno de cuarentena: se generará al confirmar\. El lote del proveedor indicado arriba no cambia\./u);
  assert.equal(state.inventoryWrites, 0);
  const correction = await send('Corrección: ubicación de la partida 2 de tapas a Q2');
  assert.equal(correction.sku_review, true);
  assert.match(correction.message, /Partida 2: 1 und · CUARENTENA · ubicación Q2/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].partidas[0].ubicacion, 'A8');
  assert.equal(state.inventoryWrites, 0);
});

test('returning to an advanced receipt reports reviewed SKUs and the next missing step', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance = {}) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: dos tapas disponibles en A8', {
    producto: 'tapas', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  await send('sí');
  await send('gomas: llegaron 100 gramos', { producto: 'gomas', cantidad: 100 });
  const prepared = { id: 101, numero: 'REC-OC-37-001', items: [
    { sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO (60 UNID)',
      cantidad_pendiente: 2, unidad: 'und', lote_documento: 'T-1',
      fecha_vencimiento_documento: '2027-12-31' },
    { sku: '00051-MPASH', producto: 'GOMAS ASHWAGANDHA', cantidad_pendiente: 100,
      unidad: 'g', lote_documento: 'G-1', fecha_vencimiento_documento: '2027-12-31' },
  ] };
  const order = { id: 37, numero: 'OC-37', tipo_recepcion: 'INSUMOS_MP' };
  const resume = await guidedReceptionResume(db, order, prepared, user.id);
  assert.match(resume, /ya tenía avance guardado; no se reinició/u);
  assert.match(resume, /SKU ya revisados: 00001-TPBI/u);
  assert.match(resume, /00051-MPASH.*faltan condición, ubicación/u);
  assert.equal(state.inventoryWrites, 0);
});

test('returning to a final reception preview shows the saved summary instead of restarting', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
    params: { avance: { producto: 'tapas', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  await advanceGuidedReception({ db, user, rawText: 'sí', params: { avance: {} } });
  const resume = await guidedReceptionResume(db,
    { id: 37, numero: 'OC-37', tipo_recepcion: 'INSUMOS_MP' },
    { id: 101, numero: 'REC-OC-37-001', items: [{
      sku: '00001-TPBI', producto: 'TAPA TARRO CUADRADO BLANCO (60 UNID)',
      cantidad_pendiente: 2, unidad: 'und', lote_documento: 'T-1',
      fecha_vencimiento_documento: '2027-12-31',
    }] }, user.id);
  assert.match(resume, /ya tenía un borrador completo; no se reinició/u);
  assert.match(resume, /Falta revisar el resumen final y confirmar/u);
  assert.match(resume, /Confirmo la recepción OC ID 37/u);
  assert.equal(state.inventoryWrites, 0);
});

test('a reception correction keeps context only while the latest processed reply is that receipt', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
    params: { avance: { producto: 'tapas', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  const latestReceipt = { action: 'AVANZAR_RECEPCION_GUIADA_OC', response: { context: {
    reception: { reception_id: 101, purchase_order_id: 37, inventory_changed: false,
      review_sku: '00001-TPBI' },
  } } };
  state.recentLog = [latestReceipt];
  assert.equal(await hasRecentReceptionContext(db, user.id, '573150000059'), true);
  state.recentLog = [{ action: 'CERRAR_ORDEN_PRODUCCION', response: { message: 'OP ID 109' } },
    latestReceipt];
  assert.equal(await hasRecentReceptionContext(db, user.id, '573150000059'), false);
});

test('an explicit OP correction cannot be mistaken for a reception correction', () => {
  assert.equal(isReceptionCorrectionRequest('Corrige ubicación de la OP 109 a C2'), false);
  assert.equal(isReceptionCorrectionRequest('Corrección, ubicación de la partida 2 de las gomas es A2'), true);
});

test('a final-preview correction without a partition number cannot alter a split SKU', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  const send = (rawText, avance = {}) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas', { producto: 'tapas' });
  await send('partidas de tapas: 1 disponible en A8; 1 en cuarentena en CUAR-C-1-01 por empaque roto');
  await send('sí');
  const before = JSON.parse(state.draft.payload_json);
  assert.equal(before.version, 1);
  await assert.rejects(send('Corrección: ubicación de tapas a Q2'),
    /Indica cuál corriges.*partida 1.*partida 2/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.equal(state.inventoryWrites, 0);
});

test('a completed single-condition preview can be corrected into two partitions', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  const send = (rawText, avance = {}) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: dos tapas disponibles en A8', {
    producto: 'tapas', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8',
  });
  await send('sí');
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  const corrected = await send('Corrección: partidas de tapas: 1 disponible en A8; 1 en cuarentena en CUAR-C-1-01 por golpe');
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Partida 2: 1 und · CUARENTENA · ubicación CUAR-C-1-01/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  const preview = await send('sí');
  assert.equal(preview.requires_confirmation, true);
  assert.match(preview.message, /Partida 2: 1 und/u);
  assert.equal(state.inventoryWrites, 0);
});

test('an explicit OC ID correction updates a partition after a final preview', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  const send = (rawText, avance = {}) => advanceGuidedReception({ db, user, rawText,
    params: { avance } });
  await send('OC ID 37: tapas', { producto: 'tapas' });
  await send('partidas de tapas: 1 disponible en A8; 1 en cuarentena en CUAR-C-1-01 por golpe');
  await send('sí');
  const corrected = await send('Corrección, ubicación de la partida 2 de las tapas de OC ID 37 es A2');
  assert.equal(corrected.sku_review, true);
  assert.match(corrected.message, /Partida 2: 1 und · CUARENTENA · ubicación A2/u);
  assert.equal(state.inventoryWrites, 0);
});

test('una recepción acepta cantidad y destino evidentes sin exigir el nombre del campo', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  const send = rawText => advanceGuidedReception({ db, user, rawText, params: { avance: {} } });
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37: dos tapas disponibles en A8',
    params: { avance: { producto: 'tapas', cantidad: 2,
      condicion: 'DISPONIBLE', ubicacion: 'A8' } } });
  await send('sí');
  await send('corrección, 1 unidad');
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].cantidad, 1);
  const location = await send('va para la A11');
  assert.match(location.message, /A11/u);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].ubicacion, 'A11');
  assert.equal(state.inventoryWrites, 0);
});

test('una partida explícita corrige solo su destino y una partida ambigua no cambia nada', async () => {
  const { db, state } = guidedDb({ singleSku: '00001-TPBI' });
  const user = { id: 5 };
  const send = rawText => advanceGuidedReception({ db, user, rawText, params: { avance: {} } });
  await send('OC ID 37: tapas');
  await send('partidas de tapas: 1 disponible en A8; 1 en cuarentena en CUAR-C-1-01 por golpe');
  await send('sí');
  await send('sí');
  await assert.rejects(send('va para la A11'), /Indica cuál corriges.*partida 1.*partida 2/u);
  const unchanged = JSON.parse(state.draft.payload_json);
  assert.equal(unchanged.version, 1);
  assert.equal(unchanged.items[0].distributions[0].ubicacion, 'A8');
  const corrected = await send('partida 1 va para la A11');
  assert.equal(corrected.sku_review, true);
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].partidas[0].ubicacion, 'A11');
  assert.equal(JSON.parse(state.draft.payload_json).entries['00001-TPBI'].partidas[1].ubicacion, 'CUAR-C-1-01');
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
