const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { additionalOperationInput } = require('../api/_lib/additional-operation-input');

// Exercise the real webhook dispatch without DB, network or inventory writes.
function harness() {
  const calls = [];
  const baseReads = [];
  const filename = path.resolve(__dirname, '../api/v1/webhook/builderbot.js');
  const nativeRequire = createRequire(filename);
  const db = {
    async end() {},
    async execute(sql, args) {
      if (sql.includes('INSERT INTO webhook_logs')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM usuarios u')) return [[{ id: 5, rol_nombre: 'admin' }]];
      if (sql.includes('FROM bodegas')) return [[{ id: 1 }]];
      if (sql.includes('FROM ordenes_produccion o')) {
        baseReads.push(args);
        return [[{ id: 79, codigo_orden: 'OP-20260906-000079', cantidad_planeada: 3,
          origen_tipo: 'STOCK_SEGURIDAD', siigo_code: '00102-PTASH60' }]];
      }
      if (sql.includes('FROM devoluciones dv')) {
        baseReads.push(args);
        return [[{ id: 30, numero: 'DEV-E0816E63', cantidad: 1, estado: 'CUARENTENA',
          lote_origen: 'REG-3Q-PT-0906-A', cliente_origen: 'Cliente QA',
          siigo_code: 'SKU-QA', despacho_numero: 'DSP-QA', observaciones: 'empaque danado' }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const mocks = {
    '../../_lib/db': { createConnection: async () => db },
    '../../_lib/auth': { requireWebhookSecret() {} },
    '../../_lib/production-workflow': { releaseProductionOrder: async input => {
      calls.push(input);
      return { order_id: 79, order_code: 'OP-79', already_released: true,
        requires_confirmation: !input.confirmNew };
    } },
    '../../_lib/returns-workflow': {
      ...nativeRequire('../../_lib/returns-workflow'),
      createCustomerReturn: async input => {
        calls.push(input);
        return { numero: 'DEV-QA', already_completed: true,
          requires_confirmation: !input.confirmar_nueva_devolucion };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: name => mocks[name] || nativeRequire(name),
    process: { env: {} }, console: { log() {}, warn() {}, error() {} }, Buffer,
  }, { filename });
  return { calls, baseReads, async send(action, text, params, outer = {}) {
    let body;
    const res = { setHeader() {}, status() { return this; }, json(value) { body = value; return this; } };
    await module.exports({ method: 'POST', headers: {}, body: {
      from: 'QA-ACTOR', info: { '@ction': action, body: text, text, query: text, params }, ...outer,
    } }, res);
    return body;
  } };
}

test('consent accepts accents/case and short IDs, but not another operation or two bases', () => {
  const action = 'GESTION_DEVOLUCION';
  const result = additionalOperationInput(action, {}, { text: 'S\u00ed, confirmo otra devoluci\u00f3n como ID 30.' });
  assert.equal(result.confirmar_nueva_devolucion, true);
  assert.equal(result.id_devolucion_existente, '30');
  for (const text of ['Confirma otra produccion como OP-79.',
    'Confirma otra devolucion como DEV-30 y DEV-31.',
    'Confirma otra devolucion como ID 9007199254740993.']) {
    assert.throws(() => additionalOperationInput(action, {}, { text }), error => error.status === 409);
  }
});

test('empty independent text and model prose cannot supply missing confirmation evidence', () => {
  const params = { confirmar_nueva_devolucion: true, id_devolucion_existente: 30 };
  const text = 'Confirma otra devolucion como ID 30.';
  assert.throws(() => additionalOperationInput('GESTION_DEVOLUCION', params,
    { text: '' }, { body: text }), /No se autorizo/);
  assert.throws(() => additionalOperationInput('GESTION_DEVOLUCION', params,
    {}, { mensaje: text, params: { body: text } }), /No se autorizo/);
});

test('unrelated actions and original operational fields remain unchanged', () => {
  const params = { cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-1' };
  assert.equal(additionalOperationInput('REPORTE_MERMA', params, {}), params);
  const clean = additionalOperationInput('GESTION_DEVOLUCION', params, { text: 'Registra la devolucion' });
  assert.deepEqual(params, { cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-1' });
  assert.deepEqual(clean, { ...params, confirmar_nueva_devolucion: false });
});

const scenarios = [
  { name: 'production', action: 'LIBERAR_ORDEN_PRODUCCION',
    text: 'Cambio el destino: produce tres tarros de ashwagandha 60 para stock de seguridad.',
    params: { id_producto_final: '00102-PTASH60', cantidad_planificada: 3, origen_tipo: 'STOCK_SEGURIDAD' },
    flags: { confirmar_nueva_orden: true, id_orden_existente: 79 },
    confirmation: 'Confirma una nueva produccion adicional para la orden ID 79.',
    flag: 'confirmNew', base: 'existingOrderId', expectedBase: '79' },
  { name: 'return', action: 'GESTION_DEVOLUCION',
    text: 'Registra una devolucion del cliente del despacho ID 58: 1 unidad de Booster60, lote REG-3Q-PT-0906-A, por empaque danado. Dejar en cuarentena en CUAR-C-1-01.',
    params: { id_item: 'SKU-QA', id_despacho: 'DSP-QA', cantidad: 1, estado: 'CUARENTENA', lote_origen: 'REG-3Q-PT-0906-A' },
    flags: { confirmar_nueva_devolucion: true, id_devolucion_existente: 'DEV-E0816E63' },
    confirmation: 'Confirmo una nueva devolucion adicional como DEV-E0816E63.',
    flag: 'confirmar_nueva_devolucion', base: 'id_devolucion_existente', expectedBase: '30' },
];

for (const s of scenarios) {
  test(`${s.name}: RI-004/008 repeated text cannot authorize model-generated additional flags`, async () => {
    const h = harness();
    assert.equal((await h.send(s.action, s.text, s.params)).ok, true);
    assert.equal((await h.send(s.action, s.text, { ...s.params, ...s.flags, confirm_new_return: true })).ok, true);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1][s.flag], false);
    assert.notEqual(h.calls[1].confirm_new_return, true);
    assert.equal(h.baseReads.length, 0);
  });

  test(`${s.name}: explicit confirmation works without model flags and uses the human-selected base`, async () => {
    const h = harness();
    const result = await h.send(s.action, s.confirmation, {});
    assert.equal(result.ok, true, result.mensaje);
    assert.equal(h.calls[0][s.flag], true);
    assert.equal(String(h.calls[0][s.base]), s.expectedBase);
    assert.equal(h.baseReads.length, 1);
  });

  test(`${s.name}: missing text or negated/quoted/ambiguous consent cannot invoke mutation`, async () => {
    for (const text of ['', `No ${s.confirmation.toLowerCase()}`, `Ayer dije: ${s.confirmation}`,
      `¿${s.confirmation}?`, s.confirmation.replace(/(?:ID 79|DEV-E0816E63)/, ''),
      `${s.confirmation} Pero cambia la cantidad a 5.`]) {
      const h = harness();
      const result = await h.send(s.action, text, { ...s.params, ...s.flags });
      assert.equal(result.ok, false, text);
      assert.equal(h.calls.length, 0, text);
      assert.equal(h.baseReads.length, 0, text);
    }
  });

  test(`${s.name}: independent current text takes precedence over a generated confirmation`, async () => {
    const h = harness();
    const result = await h.send(s.action, s.confirmation, { ...s.params, ...s.flags }, { text: s.text });
    // Production may also reject inconsistent origin evidence. Either way,
    // model-only consent must never reach the additional-operation branch.
    if (h.calls.length) assert.equal(h.calls[0][s.flag], false);
    else assert.equal(result.ok, false);
    assert.equal(h.baseReads.length, 0);
  });

  test(`${s.name}: selected base is stable on replay despite an invented model ID`, async () => {
    const h = harness();
    for (const id of ['INVENTED', '999']) {
      await h.send(s.action, s.confirmation, { ...s.flags,
        [s.name === 'production' ? 'id_orden_existente' : 'id_devolucion_existente']: id });
    }
    assert.equal(h.calls.length, 2);
    assert.equal(String(h.calls[0][s.base]), s.expectedBase);
    assert.equal(String(h.calls[1][s.base]), s.expectedBase);
  });
}
