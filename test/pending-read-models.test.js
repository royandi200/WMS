const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { buildConfirmationItems } = require('../api/_lib/builderbot-reception');
const { normalizeReceptionDistributions } = require('../api/_lib/reception-distributions');

function loadRoute(relative, query, extra = '') {
  const filename = path.resolve(__dirname, '..', relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + extra, {
    module, exports: module.exports, Buffer, process: { env: {} },
    console: { log() {}, warn() {}, error() {} },
    require: name => name.endsWith('/db') ? { query }
      : name.endsWith('/auth') ? { cors() {}, requireAuth: async () => ({ rol: 'admin' }),
        requireCapability: async () => ({ rol: 'admin' }) } : nativeRequire(name),
  }, { filename });
  return module.exports;
}

async function get(route) {
  let body, status;
  const res = { setHeader() {}, status(code) { status = code; return this; },
    json(value) { body = JSON.parse(JSON.stringify(value)); return this; } };
  await route({ method: 'GET', query: {} }, res);
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}

test('RI-002: inventory summary groups grams and pieces without a mixed scalar or assumed missing unit', async () => {
  const route = loadRoute('api/v1/inventory/summary.js', async sql => {
    if (sql.includes('AS total_productos')) return [{ total_productos: 3, productos_activos: 3 }];
    if (sql.includes('NULLIF(p.unit_label')) {
      assert.match(sql, /u.activa = 1/);
      assert.match(sql, /COALESCE\(l.expiry_date, s.fecha_venc\)/);
      return [{ cantidad: 5, disponible: 3, reservada: 1, unidad: 'und' },
        { cantidad: 2000, disponible: 1500, reservada: 100, unidad: 'gr' },
        { cantidad: 20, disponible: 20, reservada: 0, unidad: 'g' },
        { cantidad: 2, disponible: 0, reservada: 0, unidad: null }];
    }
    return [{ cnt: 0 }];
  });
  const { data } = await get(route);
  assert.equal(data.total_unidades, null);
  assert.equal(data.disponible, null);
  assert.deepEqual(data.cantidades_por_unidad, [
    { unit: 'g', quantity: 2020 }, { unit: 'sin unidad', quantity: 2 }, { unit: 'und', quantity: 5 },
  ]);
  assert.deepEqual(data.disponible_por_unidad.find(row => row.unit === 'g'), { unit: 'g', quantity: 1520 });
});

test('RI-005: reception history returns every distribution once, grouped by its reception item', async () => {
  let queries = 0;
  const route = loadRoute('api/v1/reception.js', async (sql, args) => {
    queries++;
    if (sql.includes('FROM recepciones r')) return [
      { id: 1, recepcion_item_id: 10, cantidad_rec: 5 }, { id: 1, recepcion_item_id: 11, cantidad_rec: 2 },
    ];
    assert.match(sql, /WHERE rd.recepcion_item_id IN \(\?,\?\)/);
    assert.deepEqual(Array.from(args), [10, 11]);
    return [
      { recepcion_item_id: 10, lote: 'A', cantidad: 3, condicion: 'DISPONIBLE' },
      { recepcion_item_id: 10, lote: 'B', cantidad: 1, condicion: 'CUARENTENA', motivo: 'revision' },
      { recepcion_item_id: 10, lote: 'C', cantidad: 1, condicion: 'RECHAZADO', motivo: 'roto' },
    ];
  });
  const { data } = await get(route);
  assert.equal(queries, 2);
  assert.equal(data.total, 2);
  assert.equal(data.rows[0].cantidad_rec, 5);
  assert.equal(data.rows[0].distribuciones.length, 3);
  assert.equal(data.rows[0].distribuciones[2].motivo, 'roto');
  assert.deepEqual(data.rows[1].distribuciones, []);
});

test('RI-001: WhatsApp stock is warehouse-scoped, uses eligible balances and fails closed on SQL error', async () => {
  const route = loadRoute('api/v1/webhook/builderbot.js', async () => [],
    '\nmodule.exports.stockQueryForTest = queryStockDisponible;');
  for (const sku of ['SKU-QA', null]) {
    let calls = 0;
    const db = { execute: async (sql, args) => {
      calls++;
      assert.match(sql, /b.codigo = \?/);
      assert.match(sql, /u.activa = 1/);
      assert.match(sql, /l.status = 'DISPONIBLE'/);
      assert.match(sql, /COALESCE\(l.expiry_date, s.fecha_venc\) >= CURDATE\(\)/);
      assert.deepEqual(Array.from(args), [sku || 'MP', 'BG-PPAL']);
      throw new Error('query unavailable');
    } };
    await assert.rejects(route.stockQueryForTest(db, { sku, bodega: 'BG-PPAL', tipoFiltro: 'MP' }), /query unavailable/);
    assert.equal(calls, 1);
  }
});

test('RI-003: a 3/1/1 receipt preview preserves every condition, lot and location without writes', async () => {
  const db = { execute: async (sql, values) => {
    assert.match(sql.trim(), /^SELECT/);
    if (sql.includes('FROM productos p')) return [[{ id: 100, siigo_code: 'SKU-A', nombre: 'IO QA' }]];
    assert.match(sql, /FROM ubicaciones/);
    return [[{ id: values[0] === 'B13' ? 1 : 2, codigo: values[0] }]];
  } };
  const params = { items: [{ sku: 'SKU-A', cantidad_recibida: 5, distribuciones: [
    { cantidad: 3, lote: 'QA-BUENO', fecha_vencimiento: '2028-01-31', condicion: 'DISPONIBLE', ubicacion: 'B13' },
    { cantidad: 1, lote: 'QA-REVISION', fecha_vencimiento: '2028-01-31', condicion: 'CUARENTENA', ubicacion: 'CUAR-C-1-01', motivo: 'revision' },
    { cantidad: 1, lote: 'QA-RECHAZO', fecha_vencimiento: '2028-01-31', condicion: 'RECHAZADO', ubicacion: 'CUAR-C-1-01', motivo: 'roto' },
  ] }] };
  const items = await buildConfirmationItems(db, [{ item_id: 10, producto_id: 100, sku: 'SKU-A' }], params);
  const normalized = normalizeReceptionDistributions(items[0]);
  assert.equal(normalized.totals.received, 5);
  assert.equal(normalized.totals.DISPONIBLE, 3);
  assert.equal(normalized.totals.CUARENTENA, 1);
  assert.equal(normalized.totals.RECHAZADO, 1);
  const invalid = structuredClone(items[0]);
  invalid.distributions[1].motivo = '';
  assert.throws(() => normalizeReceptionDistributions(invalid), /Motivo requerido/);
  delete params.items[0].distribuciones[0].lote;
  await assert.rejects(buildConfirmationItems(db, [{ item_id: 10, producto_id: 100, sku: 'SKU-A' }], params), /lote/i);
});
