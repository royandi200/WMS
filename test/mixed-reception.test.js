const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { normalizeReceptionDistributions, assignReceptionPartitions } = require('../api/_lib/reception-distributions');
const { buildConfirmationItems } = require('../api/_lib/builderbot-reception');
const { receptionLotPartitions, partitionTraceText } = require('../api/_lib/reception-lot-trace');
const { migrate } = require('../scripts/apply-reception-supplier-lots-migration');

function mixed() {
  return { item_id: 87, product_id: 104, sku: '00276-PTZNASHWA', cantidad_recibida: 5,
    distributions: [
      { cantidad: 3, condicion: 'DISPONIBLE', ubicacion_id: 59, ubicacion: 'B13' },
      { cantidad: 1, condicion: 'CUARENTENA', ubicacion_id: 27, ubicacion: 'CUAR-C-1-01', motivo: 'revision calidad' },
      { cantidad: 1, condicion: 'RECHAZADO', ubicacion_id: 27, ubicacion: 'CUAR-C-1-01', motivo: 'empaque roto' },
    ].map(entry => ({ ...entry, lote: 'QA-PREVIEW-20260906-IO', fecha_venc: '2027-11-30' })) };
}

function routeWith(conn) {
  const filename = path.resolve(__dirname, '../api/v1/reception.js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process: { env: {} }, console,
    require: name => name.endsWith('/db') ? { createConnection: async () => conn }
      : name.endsWith('/auth') ? { cors() {}, requireCapability: async () => ({ id: 7, rol: 'admin' }) }
      : nativeRequire(name),
  }, { filename });
  return module.exports;
}

// Transactional SQL double: unrecognised queries fail; no network or real database.
function database({ failAt, invalidLocation = false, knownLots = [] } = {}) {
  let state = { completed: false, lots: [], stock: [], distributions: [], kardex: [], movements: [], reconciliation: [] };
  let snapshot;
  const calls = [];
  return {
    get state() { return state; }, calls,
    async beginTransaction() { snapshot = structuredClone(state); },
    async rollback() { state = snapshot; }, async commit() {}, async end() {},
    async execute(raw, values = []) {
      const sql = raw.replace(/\s+/g, ' ').trim();
      calls.push({ sql, values });
      if (failAt && sql.includes(failAt)) throw new Error('Injected persistence failure');
      if (sql.startsWith('SELECT * FROM recepciones')) return [[{ id: 61, numero: 'REC-OC-6-001',
        orden_compra_id: 6, proveedor_nombre: 'Proveedor QA', bodega_id: 1, estado: state.completed ? 'completada' : 'borrador' }]];
      if (sql.startsWith('SELECT * FROM ordenes_compra_proveedor')) return [[{ id: 6, estado: 'CARGADA' }]];
      if (sql.startsWith('SELECT ri.*')) return [[{ id: 87, producto_id: 104, siigo_code: '00276-PTZNASHWA',
        cantidad_esp: 5, modalidad_operativa: 'IO', requiere_lote: 1 }]];
      if (sql.startsWith('SELECT id FROM ubicaciones')) return [values.slice(1, invalidLocation ? -1 : undefined).map(id => ({ id }))];
      if (sql.startsWith('SELECT l.product_id')) return [knownLots];
      if (sql.startsWith('SELECT id, product_id')) return [state.lots.filter(lot => lot.lpn === values[0])];
      if (sql.startsWith('INSERT INTO lots')) {
        const [id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, status, received_by, notes, expiry_date] = values;
        state.lots.push({ id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, status, received_by, notes, expiry_date });
        return [{}];
      }
      if (sql.startsWith('UPDATE lots')) {
        const lot = state.lots.find(l => l.id === values[3]);
        lot.qty_initial += values[0]; lot.qty_current += values[1]; lot.status = values[2]; return [{}];
      }
      if (sql.startsWith('INSERT INTO recepcion_distribuciones')) { state.distributions.push(values); return [{}]; }
      if (sql.startsWith('SELECT id FROM stock')) return [[]];
      if (sql.startsWith('INSERT INTO stock')) { state.stock.push(values); return [{}]; }
      if (sql.startsWith('INSERT INTO movimientos')) { state.movements.push(values); return [{}]; }
      if (sql.startsWith('INSERT INTO kardex')) {
        const migration = fs.readFileSync(path.resolve(__dirname, '../database/28_outsourcing_before_purchase_order.sql'), 'utf8');
        const enumBody = migration.match(/MODIFY COLUMN action ENUM\(([\s\S]*?)\)/)[1];
        const allowed = [...enumBody.matchAll(/'([^']+)'/g)].map(match => match[1]);
        const action = sql.match(/VALUES \(\?, \?, \?, \?, \?, '([^']+)'/)[1];
        assert.ok(allowed.includes(action), `Unsupported live-schema Kardex event: ${action}`);
        state.kardex.push({ sql, values }); return [{}];
      }
      if (sql.startsWith('INSERT INTO recepcion_novedades') || sql.startsWith('UPDATE recepcion_items')) return [{}];
      if (sql.startsWith('SELECT producto_id, SUM(cantidad_ordenada)')) return [[{ producto_id: 104, cantidad: 5 }]];
      if (sql.startsWith('SELECT COALESCE(SUM(ri.cantidad_esp)')) return [[{ facturada: 5, fisica: 5 }]];
      if (sql.startsWith('SELECT COALESCE(SUM(accepted.cantidad)')) return [[{
        aceptada: state.distributions.filter(d => d[6] === 'DISPONIBLE').reduce((n, d) => n + d[7], 0),
      }]];
      if (sql.startsWith('INSERT INTO recepcion_conciliacion_items')) { state.reconciliation.push(values); return [{}]; }
      if (sql.startsWith('UPDATE ordenes_compra_proveedor')) return [{}];
      if (sql.startsWith('UPDATE recepciones')) { if (sql.includes("estado = 'completada'")) state.completed = true; return [{}]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('mixed same-supplier-lot partitions are deterministic and preserve the original label', () => {
  const input = mixed();
  const normal = normalizeReceptionDistributions(input);
  const planned = assignReceptionPartitions(normal, 61, 87);
  assert.equal(planned.totals.received, 5);
  assert.equal(planned.totals.DISPONIBLE, 3);
  assert.equal(new Set(planned.distributions.map(d => d.lot)).size, 3);
  assert.equal(planned.distributions[0].lot, input.distributions[0].lote);
  assert.ok(planned.distributions.every(d => d.supplierLot === input.distributions[0].lote));
  assert.deepEqual(assignReceptionPartitions(normalizeReceptionDistributions({ ...input,
    distributions: [...input.distributions].reverse() }), 61, 87).distributions.reverse(), planned.distributions);
  assert.notEqual(assignReceptionPartitions(normal, 62, 87).distributions[1].lot, planned.distributions[1].lot);
});

test('actual confirmation writes only 3 available, audits both blocked parts and replay writes nothing', async () => {
  const conn = database();
  const route = routeWith(conn);
  const request = { body: { recepcion_id: 61, items: [mixed()] }, user: { id: 7, rol: 'admin' } };
  const result = await route.confirmReceptionForUser(request);
  assert.equal(result.items[0].disponible, 3);
  assert.equal(result.items[0].cuarentena, 1);
  assert.equal(result.items[0].rechazado, 1);
  assert.equal(result.conciliacion[0].saldo_oc, 2);
  assert.equal(conn.state.lots.reduce((n, l) => n + l.qty_current, 0), 5);
  assert.equal(conn.state.stock.length, 1);
  assert.equal(conn.state.stock[0][5], 3);
  assert.equal(conn.state.movements.length, 1);
  assert.equal(conn.state.kardex.length, 3);
  assert.ok(conn.state.kardex.every(k => k.sql.includes("'INGRESO_RECEPCION'")));
  assert.equal(conn.state.kardex.filter(k => k.values[8].includes('Ingreso fisico bloqueado; disponible +0')).length, 2);
  assert.equal(new Set(conn.state.kardex.map(k => k.values[1])).size, 3);
  assert.ok(conn.state.distributions.every(d => d[4] === mixed().distributions[0].lote));
  const before = JSON.stringify(conn.state);
  const writes = conn.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql)).length;
  assert.equal((await route.confirmReceptionForUser(request)).already_completed, true);
  assert.equal(JSON.stringify(conn.state), before);
  assert.equal(conn.calls.filter(c => /^(INSERT|UPDATE)/.test(c.sql)).length, writes);
});

test('mixed reception rolls back every inventory write if a distribution cannot be saved', async () => {
  const conn = database({ failAt: 'INSERT INTO recepcion_distribuciones' });
  await assert.rejects(routeWith(conn).confirmReceptionForUser({ body: { recepcion_id: 61, items: [mixed()] }, user: { id: 7 } }), /Injected/);
  assert.equal(conn.state.lots.length, 0);
  assert.equal(conn.state.stock.length, 0);
  assert.equal(conn.state.kardex.length, 0);
  assert.equal(conn.state.completed, false);
});

test('single-condition receipts and a blocked lot in two locations retain exact physical balances', async () => {
  for (const condition of ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO']) {
    const input = mixed();
    input.distributions = [{ ...input.distributions[0], cantidad: 5, condicion: condition, motivo: 'revision' }];
    const conn = database();
    const result = await routeWith(conn).confirmReceptionForUser({ body: { recepcion_id: 61, items: [input] }, user: { id: 7 } });
    assert.equal(result.items[0].recibido, 5);
    assert.equal(conn.state.lots.length, 1);
    assert.equal(conn.state.lots[0].status, condition);
    assert.equal(conn.state.stock.length, condition === 'DISPONIBLE' ? 1 : 0);
  }
  const input = mixed();
  input.distributions = [
    { ...input.distributions[1], cantidad: 2 },
    { ...input.distributions[1], cantidad: 3, ubicacion_id: 59 },
  ];
  const conn = database();
  await routeWith(conn).confirmReceptionForUser({ body: { recepcion_id: 61, items: [input] }, user: { id: 7 } });
  assert.equal(conn.state.lots.length, 1);
  assert.equal(conn.state.lots[0].qty_current, 5);
  assert.deepEqual(conn.state.kardex.map(k => k.values[6]), [2, 5]);
  assert.equal(conn.state.stock.length, 0);
});

test('GET lot resolves a supplier label to its available part and includes quarantine/rejection', async () => {
  const filename = path.resolve(__dirname, '../api/v1/inventory/lot/[lpn].js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const partitions = mixed().distributions.map(d => ({ ...d, product_id: 104, bodega_id: 1,
    lote_proveedor: d.lote, lote: d.condicion === 'DISPONIBLE' ? d.lote : `RECBLK-${d.condicion}` }));
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console,
    require: name => name.endsWith('/db') ? { query: async (sql, values) => {
      if (sql.includes('FROM recepcion_distribuciones rd')) return partitions;
      assert.match(sql, /FROM lots l/);
      assert.equal(values[0], 'QA-PREVIEW-20260906-IO');
      return [{ lpn: values[0], qty_current: 3, qty_initial: 3, status: 'DISPONIBLE' }];
    } } : name.endsWith('/auth') ? { cors() {}, requireAuth: async () => ({ rol: 'admin' }) } : nativeRequire(name),
  }, { filename });
  let status, body;
  await module.exports({ method: 'GET', query: { lpn: 'QA-PREVIEW-20260906-IO' } }, {
    status(code) { status = code; return this; }, json(value) { body = value; },
  });
  assert.equal(status, 200);
  assert.equal(body.data.qty_current, 3);
  assert.equal(body.data.partidas_recepcion.length, 3);
});

test('mixed reception rejects another warehouse or inconsistent known expiry before inventory writes', async () => {
  for (const options of [{ invalidLocation: true }, { knownLots: [{ product_id: 104, bodega_id: 1,
    supplier: 'Proveedor QA', expiry_date: '2028-01-31' }] }]) {
    const conn = database(options);
    await assert.rejects(routeWith(conn).confirmReceptionForUser({ body: { recepcion_id: 61, items: [mixed()] }, user: { id: 7 } }),
      /ubicacion|vencimiento/);
    assert.equal(conn.calls.some(c => c.sql.startsWith('INSERT INTO lots')), false);
  }
});

test('WhatsApp preview validates the same mixed payload and rejects omissions before saving a draft', async () => {
  const db = { async execute(sql, values) {
    assert.match(sql.trim(), /^SELECT/);
    if (sql.includes('FROM productos p')) return [[{ id: 104, siigo_code: '00276-PTZNASHWA', nombre: 'Zenova' }]];
    assert.match(sql, /FROM ubicaciones/);
    return [[{ id: values[0] === 'B13' ? 59 : 27, codigo: values[0] }]];
  } };
  const prepared = [{ item_id: 87, producto_id: 104, cantidad_pendiente: 5 }];
  assert.equal((await buildConfirmationItems(db, prepared, { items: [mixed()] }))[0].distributions.length, 3);
  const mutations = [
    d => { d.distributions[1].motivo = ''; },
    d => { d.distributions[1].fecha_venc = '2027-02-31'; },
    d => { d.distributions[1].fecha_venc = '2028-01-31'; },
    d => { d.cantidad_recibida = 'NaN'; },
    d => { d.distributions[1].cantidad = -1; },
    d => { d.distributions[1].condicion = 'IGNORADO'; },
    d => { d.distributions[1].lote = ''; },
    d => { d.distributions[1].ubicacion = ''; },
  ];
  for (const mutate of mutations) {
    const input = mixed(); mutate(input);
    await assert.rejects(buildConfirmationItems(db, prepared, { items: [input] }));
  }
});

test('supplier-lot trace includes all conditions without adding blocked stock to availability', async () => {
  const rows = mixed().distributions.map((d, i) => ({ product_id: 104, bodega_id: 1,
    lote_proveedor: d.lote, lote: i ? `RECBLK-${i}` : d.lote,
    condicion: d.condicion, cantidad: d.cantidad, ubicacion: d.ubicacion,
    recepcion: 'REC-OC-6-001', motivo: d.motivo }));
  for (const reference of ['QA-PREVIEW-20260906-IO', 'RECBLK-1']) {
    assert.deepEqual(await receptionLotPartitions({ async execute(sql, values) {
      assert.match(sql, /BINARY source.lote = BINARY \?/);
      assert.deepEqual(values, [reference, reference]); return [rows];
    } }, reference), rows);
  }
  const text = partitionTraceText(rows);
  assert.match(text, /CUARENTENA: recibido 1/);
  assert.match(text, /RECHAZADO: recibido 1/);
  await assert.rejects(receptionLotPartitions({ execute: async () => [[...rows, { ...rows[0], product_id: 999 }]] }, 'LOT'), /varios productos/);
});

test('supplier-lot migration is read-only by default and repeatable after explicit application', async () => {
  let exists = false, writes = 0;
  const conn = { execute: async () => [exists ? [{ COLUMN_NAME: 'lote_proveedor' }] : []],
    async query(sql) { assert.match(sql, /ADD COLUMN lote_proveedor/); exists = true; writes++; } };
  assert.equal((await migrate(conn)).pending, true);
  assert.equal(writes, 0);
  assert.equal((await migrate(conn, true)).pending, false);
  assert.equal((await migrate(conn, true)).mode, 'already-applied');
  assert.equal(writes, 1);
});
