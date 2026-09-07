const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfirmationItems, confirmReceptionFromWhatsApp, findPreparedReception } = require('../api/_lib/builderbot-reception');

const prepared = [{ item_id: 87, producto_id: 104, cantidad_pendiente: 5 }];
const db = { async execute(sql, values) {
  assert.match(sql.trim(), /^SELECT/);
  if (sql.includes('FROM productos p')) return [[{ id: 104, siigo_code: '00276-PTZNASHWA', nombre: 'Zenova' }]];
  assert.match(sql, /FROM ubicaciones/);
  return [[{ id: values[0] === 'B13' ? 59 : 27, codigo: values[0] }]];
} };
function fragments() {
  return [
    { cantidad: 3, condicion: 'DISPONIBLE', ubicacion: 'B13' },
    { cantidad: 1, condicion: 'CUARENTENA', ubicacion: 'CUAR-C-1-01', motivo: 'revision' },
    { cantidad: 1, condicion: 'RECHAZADO', ubicacion: 'CUAR-C-1-01', motivo: 'roto' },
  ].map(entry => ({ sku: '00276-PTZNASHWA', cantidad_recibida: entry.cantidad,
    distributions: [{ ...entry, lote: 'FISICO-QA', fecha_venc: '2027-11-30' }] }));
}

test('one SKU split by AI into disjoint conditions becomes one reviewed item without changing quantities', async () => {
  const input = fragments();
  input[1].sku = 'Zenova';
  const result = await buildConfirmationItems(db, prepared, { items: input });
  assert.equal(result.length, 1);
  assert.equal(result[0].cantidad_recibida, 5);
  assert.deepEqual(result[0].distributions.map(d => d.cantidad), [3, 1, 1]);
  assert.deepEqual(await buildConfirmationItems(db, prepared, { items: result }), result);
});

test('overlapping fragments including aliases or changed quantities fail closed, never deduplicated or summed', async () => {
  for (const change of [() => {}, d => { d.distributions[0].cantidad = 2; d.cantidad_recibida = 2; },
    d => { d.distributions[0].condicion = 'BUENA'; d.sku = 'Zenova'; },
    d => { d.distributions[0].lote = 'fisico-qa'; }]) {
    const first = fragments()[0]; const duplicate = structuredClone(first); change(duplicate);
    await assert.rejects(buildConfirmationItems(db, prepared, { items: [first, duplicate] }), /repetidas/);
  }
});

test('fragment subtotal contradictions, incompatible expiry and combined available overage remain blocked', async () => {
  const wrongSubtotal = fragments(); wrongSubtotal[0].cantidad_recibida = 5;
  await assert.rejects(buildConfirmationItems(db, prepared, { items: wrongSubtotal }), /suma/);
  const wrongExpiry = fragments(); wrongExpiry[1].distributions[0].fecha_venc = '2028-01-31';
  await assert.rejects(buildConfirmationItems(db, prepared, { items: wrongExpiry }), /vencimientos/);
  const overage = fragments().slice(0, 2);
  overage[1].cantidad_recibida = 3; overage[1].distributions[0].cantidad = 3;
  overage[1].distributions[0].condicion = 'DISPONIBLE';
  await assert.rejects(buildConfirmationItems(db, prepared, { items: overage }), /sobrante/);
});

test('grouping retains missing-field, total-distribution limit and required-product guards', async () => {
  for (const key of ['lote', 'fecha_venc', 'ubicacion', 'motivo']) {
    const input = fragments(); delete input[1].distributions[0][key];
    await assert.rejects(buildConfirmationItems(db, prepared, { items: input }));
  }
  const input = Array.from({ length: 21 }, (_, i) => {
    const item = fragments()[0]; item.distributions[0].lote += i; return item;
  });
  await assert.rejects(buildConfirmationItems(db, prepared, { items: input }), /20 distribuciones/);
  await assert.rejects(buildConfirmationItems(db, [...prepared, { producto_id: 105, sku: 'OTHER' }],
    { items: fragments() }), /Falta confirmar: OTHER/);
});

function replayDb({ active = [], completed = true } = {}) {
  const calls = [];
  return { calls, async execute(sql) {
    calls.push(sql); assert.match(sql.trim(), /^SELECT/);
    if (sql.includes('FROM ordenes_compra_proveedor')) return [[{ id: 6, numero: 'OC-6', estado: 'RECIBIDA_PARCIAL' }]];
    if (sql.includes("estado IN ('borrador', 'en_proceso')")) return [active];
    if (sql.includes("estado = 'completada'")) return [completed ? [{ id: 61, numero: 'REC-OC-6-001', estado: 'completada' }] : []];
    throw new Error('Unexpected query');
  } };
}
const replay = db => confirmReceptionFromWhatsApp({ db, params: { orden_compra_id: 6, confirmacion_final: true },
  rawText: 'Confirmo la recepcion ID 6', user: { id: 5 } });

test('explicit confirmation of partial OC without active reception reports completed using read-only queries', async () => {
  const conn = replayDb();
  const result = await replay(conn);
  assert.equal(result.already_completed, true);
  assert.equal(result.numero, 'REC-OC-6-001');
});

test('missing receipt and multiple active receipts still fail closed', async () => {
  await assert.rejects(replay(replayDb({ completed: false })), /Prepara primero/);
  const conn = replayDb({ active: [{ id: 62 }, { id: 63 }] });
  await assert.rejects(replay(conn), /varias recepciones/);
  assert.equal(conn.calls.some(s => s.includes("estado = 'completada'")), false);
});

test('physical report or AI-only confirmation flag does not silently resolve to old completed reception', async () => {
  const conn = replayDb();
  await assert.rejects(confirmReceptionFromWhatsApp({ db: conn,
    params: { orden_compra_id: 6, confirmacion_final: true, items: fragments() },
    rawText: 'Llegaron otras cinco unidades para la recepcion ID 6', user: { id: 5 } }), /Prepara primero/);
  assert.equal(conn.calls.some(s => s.includes("estado = 'completada'")), false);
});

test('a new active partial receipt takes precedence and still needs its own valid reviewed draft', async () => {
  const active = { id: 62, numero: 'REC-OC-6-002', estado: 'borrador' };
  const conn = replayDb({ active: [active] });
  assert.deepEqual(await findPreparedReception(conn, 6, {}, { allowCompleted: true }), active);
  assert.equal(conn.calls.some(s => s.includes("estado = 'completada'")), false);
});
