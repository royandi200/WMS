const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { beginAdditionalConfirmation } = require('../api/_lib/additional-confirmation');
const { additionalOperationInput } = require('../api/_lib/additional-operation-input');

// Transaction fixture: private writes, unique-key contention, commit and rollback.
// Unknown SQL fails so a new business path cannot silently pass these tests.
function database() {
  const state = { rows: new Map(), locks: new Map(), writes: [], nextId: 100, fail: false, closed: false };
  state.connect = async () => {
    let pending = null;
    let key;
    let unlock;
    let writes = [];
    return {
      async beginTransaction() {},
      async commit() {
        if (pending) state.rows.set(key, structuredClone(pending));
        state.writes.push(...writes);
        writes = [];
        pending = null;
        unlock?.(); unlock = null;
      },
      async rollback() { pending = null; writes = []; unlock?.(); unlock = null; },
      async end() {},
      async execute(raw, args = []) {
        const sql = raw.replace(/\s+/g, ' ').trim();
        if (/^SELECT id FROM (mermas|devoluciones|ordenes_produccion|movimientos) WHERE id/.test(sql)) {
          return [args[1] === 'MISSING' ? [] : [{ id: 1 }]];
        }
        if (sql.startsWith('INSERT INTO confirmaciones_adicionales')) {
          key = JSON.stringify(args.slice(0, 3));
          const previous = state.locks.get(key) || Promise.resolve();
          const gate = new Promise(resolve => { unlock = resolve; });
          state.locks.set(key, previous.then(() => gate));
          await previous;
          pending = structuredClone(state.rows.get(key) || { payload_hash: args[3], resultado: null });
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('SELECT payload_hash, resultado')) return [[pending]];
        if (sql.startsWith('UPDATE confirmaciones_adicionales')) {
          if (pending.resultado != null) return [{ affectedRows: 0 }];
          pending.resultado = args[0];
          return [{ affectedRows: 1 }];
        }
        if (/SELECT (GET_LOCK|RELEASE_LOCK)/.test(sql)) return [[{ acquired: 1, released: 1 }]];
        if (state.closed) throw new Error('Business state changed; retries must not reach inventory');
        if (state.fail && (sql.startsWith('INSERT INTO kardex') || sql.startsWith('UPDATE stock SET reservada'))) throw new Error('injected rollback');
        if (/^(INSERT INTO|UPDATE) (stock|lots|mermas|devoluciones|recepciones|recepcion_items|movimientos|kardex|ordenes_produccion|produccion_materiales|produccion_material_lotes)\b/.test(sql)) {
          writes.push(sql.split(' ').slice(0, 3).join(' '));
          return [{ insertId: state.nextId++, affectedRows: 1 }];
        }
        if (/FROM (mermas m|devoluciones dv)/.test(sql)) {
          return [sql.includes('DATE_SUB') && state.recentReturn ? [state.recentReturn] : []];
        }
        if (/FROM ordenes_produccion/.test(sql)) {
          return sql.includes('DATE_SUB') ? [state.recentProduction ? [state.recentProduction] : []]
            : [[{ id: 7, codigo_orden: 'OP-7', estado: 'EN_PROCESO', producto_id: 1 }]];
        }
        if (/FROM bom b/.test(sql)) return [[{ id: 1, insumo_id: 1, cantidad_por_unidad: 1, unidad: 'und', sku: 'SKU-1', nombre: 'QA' }]];
        if (/FROM produccion_materiales/.test(sql)) return [[{ id: 1, producto_id: 1, unidad: 'und' }]];
        if (/FROM produccion_material_lotes/.test(sql)) return [[{ id: 1 }]];
        if (/FROM movimientos/.test(sql)) return [[]];
        if (/FROM stock/.test(sql)) return [[{ id: 1, bodega_id: 1, ubicacion_id: 1, cantidad: 50, reservada: 0, disponible: 50, lote: 'LOT-1', codigo: 'B1', ubicacion_codigo: 'B1', balance: 49 }]];
        if (/FROM lots/.test(sql)) return [[{ id: 'LOT-ID', lpn: 'LOT-1', product_id: 1, bodega_id: 1, status: 'DISPONIBLE', qty_current: 50 }]];
        if (/FROM despachos/.test(sql)) return [[{ id: 1, numero: 'DSP-1', estado: 'despachado', bodega_id: 1, cliente_nombre: 'QA', tercero_id: 1, siigo_invoice_id: 'FV-1', siigo_invoice_name: 'FV-1' }]];
        if (/FROM despacho_items/.test(sql)) return [[{ id: 1, producto_id: 1, lote: 'LOT-1', cantidad_des: 10, expiry_date: '2028-01-01' }]];
        if (/FROM ubicaciones/.test(sql)) return [[{ id: 1, codigo: 'B1' }]];
        if (/FROM devoluciones WHERE despacho_item_id/.test(sql)) return [[{ total: 0 }]];
        throw new Error(`Unhandled SQL: ${sql}`);
      },
    };
  };
  return state;
}

function workflow(file, db) {
  const filename = path.resolve(__dirname, '../api/_lib', file);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const mocks = {
    './db': { createConnection: db.connect },
    './warehouses': { resolvePrimaryWarehouse: async () => 1 },
    './product-modes': { assertInternalProductionProduct() {} },
    './builderbot-notifications': { notifyRoles: async () => { db.notifications = (db.notifications || 0) + 1; return []; } },
    './product-references': { resolveProductReference: async () => ({ id: 1, siigo_code: 'SKU-1', nombre: 'QA' }) },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => mocks[name] || nativeRequire(name), module, exports: module.exports,
    process, console,
  }, { filename });
  return module.exports;
}

const cases = [
  { name: 'waste', file: 'waste-workflow.js', fn: 'reportWaste', done: 'already_completed', insert: 'INSERT INTO mermas',
    args: { id_item: 'SKU-1', id_lote: 'LOT-1', ubicacion: 'B1', cantidad: 1, motivo: 'QA', confirmar_nueva_merma: true, id_merma_existente: 1 } },
  { name: 'return', file: 'returns-workflow.js', fn: 'createCustomerReturn', done: 'already_completed', insert: 'INSERT INTO devoluciones',
    args: { id_item: 'SKU-1', id_despacho: 'DSP-1', lote_origen: 'LOT-1', ubicacion: 'B1', cantidad: 1, estado: 'RECUPERABLE', confirmar_nueva_devolucion: true, id_devolucion_existente: 1 } },
  { name: 'production', file: 'production-workflow.js', fn: 'releaseProductionOrder', done: 'already_released', insert: 'INSERT INTO ordenes_produccion',
    args: { product: 'SKU-1', quantity: 1, originType: 'STOCK_SEGURIDAD', userId: 5, confirmNew: true, existingOrderId: 1 } },
  { name: 'material', file: 'production-materials.js', fn: 'adjustProductionMaterials', done: 'already_recorded', insert: 'INSERT INTO movimientos',
    args: { orderId: 7, productTerm: 'SKU-1', lot: 'LOT-1', locationCode: 'B1', type: 'ENTREGA_ADICIONAL', quantity: 1, userId: 5, confirmNew: true, existingAdjustmentId: 1 } },
];

for (const scenario of cases) {
  const invoke = (db, args = scenario.args) => workflow(scenario.file, db)[scenario.fn](args, 5, { allowGeneratedReference: true });
  test(`${scenario.name}: additional confirmation executes once; replay precedes mutable state checks`, async () => {
    const db = database();
    const first = await invoke(db);
    assert.equal(first[scenario.done], false);
    const before = db.writes.length;
    db.closed = true;
    const replay = await invoke(db);
    assert.equal(replay[scenario.done], true);
    assert.equal(replay.numero || replay.order_code, first.numero || first.order_code);
    assert.equal(db.writes.length, before);
    assert.equal(db.writes.filter(sql => sql === scenario.insert).length, 1);
    if (scenario.name === 'production') assert.equal(db.notifications, 1);
  });
  test(`${scenario.name}: concurrent retries serialize into one operation`, async () => {
    const db = database();
    const results = await Promise.all([invoke(db), invoke(db)]);
    assert.equal(results.filter(result => result[scenario.done] === false).length, 1);
    assert.equal(db.writes.filter(sql => sql === scenario.insert).length, 1);
  });
  test(`${scenario.name}: changed quantities cannot reuse the same confirmation`, async () => {
    const db = database();
    await invoke(db);
    const before = db.writes.length;
    const field = 'cantidad' in scenario.args ? 'cantidad' : 'quantity';
    await assert.rejects(invoke(db, { ...scenario.args, [field]: 2 }), /datos diferentes/);
    assert.equal(db.writes.length, before);
  });
  {
    test(`${scenario.name}: a failed transaction does not consume confirmation or retain inventory writes`, async () => {
      const db = database();
      db.fail = true;
      await assert.rejects(invoke(db), /injected rollback/);
      assert.equal(db.rows.size, 0);
      assert.equal(db.writes.length, 0);
      db.fail = false;
      const result = await invoke(db);
      assert.equal(result[scenario.done], false);
      assert.equal(db.writes.filter(sql => sql === scenario.insert).length, 1);
    });
  }
}

test('additional confirmations fail closed without a valid base or storage', async () => {
  const db = database();
  const conn = await db.connect();
  const input = { kind: 'MERMA', userId: 5, payload: { quantity: 1 } };
  await assert.rejects(beginAdditionalConfirmation(conn, input), /Falta seleccionar/);
  await assert.rejects(beginAdditionalConfirmation(conn, { ...input, base: 'MISSING' }), /unico registro/);
  await assert.rejects(beginAdditionalConfirmation(conn, { ...input, base: 1, kind: 'DROP TABLE' }), /invalida/);
  await assert.rejects(beginAdditionalConfirmation({ execute: async () => { throw new Error('storage unavailable'); } }, { ...input, base: 1 }), /storage unavailable/);
  assert.equal(db.writes.length, 0);
});

test('dashboard and WhatsApp initial waste and return requests generate references without user codes', async () => {
  for (const scenario of cases.slice(0, 2)) {
    const db = database();
    const args = { ...scenario.args, confirmar_nueva_merma: false, confirmar_nueva_devolucion: false };
    const result = await workflow(scenario.file, db)[scenario.fn](args, 5, { allowGeneratedReference: true });
    assert.equal(result.generated_reference, true);
    assert.match(result.referencia_externa, /^AUTO-(MER|DEV)-\d{8}-[A-F0-9]{8}$/);
  }
});

test('RI-004: sanitized model flag reaches the real production duplicate detector without reserving', async () => {
  const db = database();
  db.recentProduction = { id: 79, codigo_orden: 'OP-79', estado: 'APROBADA',
    cantidad_planeada: 3, origen_tipo: 'STOCK_SEGURIDAD' };
  const input = additionalOperationInput('LIBERAR_ORDEN_PRODUCCION', {
    confirmar_nueva_orden: true, id_orden_existente: 79,
  }, { text: 'Cambio el destino: produce tres tarros de ashwagandha 60 para stock de seguridad.' });
  const result = await workflow('production-workflow.js', db).releaseProductionOrder({
    product: 'SKU-1', quantity: 3, originType: 'STOCK_SEGURIDAD', userId: 5,
    confirmNew: input.confirmar_nueva_orden, existingOrderId: input.id_orden_existente,
  });
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.order_id, 79);
  assert.equal(db.writes.length, 0);
  assert.equal(db.rows.size, 0);
  assert.equal(db.notifications || 0, 0);
});

test('RI-008: sanitized return flag preserves the real duplicate detector and inventory', async () => {
  const db = database();
  db.recentReturn = { id: 30, numero: 'DEV-30', cantidad: 1, estado: 'CUARENTENA' };
  const input = additionalOperationInput('GESTION_DEVOLUCION', {
    id_item: 'SKU-1', id_despacho: 'DSP-1', lote_origen: 'LOT-1', cantidad: 1,
    estado: 'CUARENTENA', confirmar_nueva_devolucion: true, id_devolucion_existente: 30,
    confirm_new_return: true,
  }, { text: 'Registra una devolucion del cliente del despacho ID 58: 1 unidad, por empaque danado. Dejar en cuarentena.' });
  const result = await workflow('returns-workflow.js', db).createCustomerReturn(input, 5);
  assert.equal(result.requires_confirmation, true);
  assert.equal(result.numero, 'DEV-30');
  assert.equal(db.writes.length, 0);
  assert.equal(db.rows.size, 0);
});
