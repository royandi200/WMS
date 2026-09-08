const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { additionalOperationInput } = require('../api/_lib/additional-operation-input');

// Exercise the real webhook dispatch without DB, network or inventory writes.
function harness({ operationError, role = 'admin' } = {}) {
  const calls = [];
  const baseReads = [];
  const filename = path.resolve(__dirname, '../api/v1/webhook/builderbot.js');
  const nativeRequire = createRequire(filename);
  const db = {
    async end() {},
    async execute(sql, args) {
      if (sql.includes('INSERT INTO webhook_logs')) return [{ affectedRows: 1 }];
      if (sql.includes('FROM usuarios u')) return [[{ id: 5, rol_nombre: role }]];
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
    '../../_lib/dispatch-workflow': {
      confirmImportedDispatch: async input => { calls.push(input); return { numero: 'DSP-QA', lotes: [] }; },
    },
    '../../_lib/builderbot-reception': {
      ...nativeRequire('../../_lib/builderbot-reception'),
      confirmReceptionFromWhatsApp: async input => {
        calls.push(input);
        return { requires_confirmation: true, inventory_changed: false, message: 'Resumen QA; confirma despues.' };
      },
    },
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
        if (operationError) throw operationError;
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

test('N1-05 real webhook: partial intent never reaches dispatch; complete confirmation still works', async () => {
  const h = harness();
  const result = await h.send('CONFIRMAR_DESPACHO_SIIGO',
    'Confirma parcialmente el despacho ID 60 enviando solo 1 unidad de las 2 solicitadas.', { id_despacho: 60 });
  assert.equal(result.ok, false);
  assert.equal(h.calls.length, 0);
  const complete = await h.send('CONFIRMAR_DESPACHO_SIIGO', 'Confirma el despacho ID 60.', { id_despacho: 60 });
  assert.equal(complete.ok, true, complete.mensaje);
  assert.equal(h.calls.length, 1);
  await h.send('CONFIRMAR_DESPACHO_SIIGO', 'Confirma el despacho ID 60 con 2 unidades.', { id_despacho: 60 });
  assert.equal(h.calls[1].expectedQuantity, 2);
});

test('N1-09 real webhook: malformed mixed receipt reaches preview only, with RBAC preserved', async () => {
  const text = 'Para la recepcion OC ID 18 llegaron 5 unidades, 3 disponibles, 1 cuarentena y 1 rechazada.';
  const info = { '@ction': 'CONFIRMAR_RECEPCION_OC', body: text, params: {
    orden_compra_id: 18, confirmacion_final: false, items: [{ sku: 'SKU-QA', cantidad_recibida: 5,
      distribuciones: [3, 1, 1].map((cantidad, i) => ({ cantidad,
        condicion: ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO'][i], lote: 'LOT-QA',
        ubicacion: 'B13', fecha_vencimiento: '2027-11-30', motivo: 'QA' })) }],
  } };
  const malformed = JSON.stringify(info).replace(/\}\]\}\]\}\}$/, '}]}}}');
  for (const role of ['admin', 'alistador']) {
    const h = harness({ role });
    const result = await h.send('', '', {}, { body: text, text, info: malformed });
    assert.equal(result.ok, role === 'admin', result.mensaje);
    assert.equal(h.calls.length, role === 'admin' ? 1 : 0);
    if (h.calls.length) {
      assert.equal(h.calls[0].params.confirmacion_final, false);
      assert.equal(result.context.reception.inventory_changed, false);
      assert.equal(h.calls[0].params.items[0].distribuciones.length, 3);
    }
  }
});

test('RI-006/009: webhook blocks a customer return substituted for production materials or destruction', async () => {
  for (const text of ['Devuelvo 5 gramos de gomas de la orden ID 79',
    'Destruye una unidad de la devolucion ID 30']) {
    const h = harness();
    const result = await h.send('GESTION_DEVOLUCION', text, {
      id_item: 'SKU-QA', cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-QA',
    });
    assert.equal(result.ok, false);
    assert.match(result.mensaje, /No se (?:modifico inventario|registro otra operacion)/);
    assert.equal(h.calls.length, 0);
  }
});

test('flat reception traverses real webhook with permissions, totals and preview-only boundaries', async () => {
  const params = { orden_compra_id: 21, confirmacion_final: false,
    partidas: [3, 1, 1].map((cantidad, i) => ({ sku: 'SKU-QA', total_recibido: 5,
      cantidad, condicion: ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO'][i], lote: 'LOT-QA',
      ubicacion: 'B13', fecha_vencimiento: '2027-11-30', motivo: 'QA' })) };
  for (const role of ['admin', 'recepcion_cierre', 'alistador']) {
    const h = harness({ role });
    const result = await h.send('CONFIRMAR_RECEPCION_OC', 'Para la recepcion OC ID 21 llegaron 5 unidades', params);
    assert.equal(result.ok, role !== 'alistador', result.mensaje);
    assert.equal(h.calls.length, role !== 'alistador' ? 1 : 0);
    if (h.calls.length) {
      assert.deepEqual(h.calls[0].params.items[0].distribuciones.map(r => r.cantidad), [3, 1, 1]);
      assert.equal(result.context.reception.inventory_changed, false);
    }
  }
  for (const bad of [{ ...params, confirmacion_final: true }, { ...params, items: [] },
    { ...params, partidas: [{ ...params.partidas[0], cantidad: 6 }] }]) {
    const h = harness();
    assert.equal((await h.send('CONFIRMAR_RECEPCION_OC', 'Confirmo la recepcion OC ID 21', bad)).ok, false);
    assert.equal(h.calls.length, 0);
  }
});

test('webhook hides SQL failures and does not automatically repeat a failed inventory operation', async () => {
  const h = harness({ operationError: Object.assign(new Error('SQL internal details'), {
    code: 'ER_LOCK_DEADLOCK', sql: 'UPDATE private_table SET value=secret',
  }) });
  const result = await h.send('GESTION_DEVOLUCION', 'Registra una devolucion del cliente', {
    id_item: 'SKU-QA', cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-QA',
  });
  assert.equal(result.ok, false);
  assert.match(result.mensaje, /concurrencia/);
  assert.doesNotMatch(JSON.stringify(result), /private_table|secret|SQL internal/);
  assert.equal(h.calls.length, 1);
});

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
  test(`${s.name}: stale BBC document event is not human text or consent`, async () => {
    const marker = '_event_document__d0df89e8-fa7a-417f-949b-1094374a38e1';
    const outer = { body: marker, text: marker, query: marker };
    const h = harness();
    const result = await h.send(s.action, s.confirmation, {}, outer);
    assert.equal(result.ok, true, result.mensaje);
    assert.equal(h.calls[0][s.flag], true);
    const repeat = harness();
    await repeat.send(s.action, s.text, { ...s.params, ...s.flags }, outer);
    assert.equal(repeat.calls[0][s.flag], false);
    const missing = harness();
    assert.equal((await missing.send(s.action, '', s.flags, outer)).ok, false);
    assert.equal(missing.calls.length, 0);
    const denied = harness();
    assert.equal((await denied.send(s.action, s.confirmation, s.flags,
      { body: marker, text: 'No confirmo otra operacion.' })).ok, false);
    assert.equal(denied.calls.length, 0);
  });

  test(`${s.name}: N1-04 exact BBC timestamp after PDF preserves explicit consent and base on replay`, async () => {
    const h = harness();
    const marker = '_event_document__cc05fd12-630d-4b49-b065-f9da56993581';
    const text = '[Sunday, September 6, 2026 23:34:14]: ' + s.confirmation;
    for (let i = 0; i < 2; i++) {
      const result = await h.send(s.action, text, {}, { body: marker, text: marker, query: marker });
      assert.equal(result.ok, true, result.mensaje);
      assert.equal(h.calls[i][s.flag], true);
      assert.equal(String(h.calls[i][s.base]), s.expectedBase);
    }
  });

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
