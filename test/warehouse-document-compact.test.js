const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeWarehouseDocumentInput, registerWarehouseDocumentDraft } = require('../api/_lib/warehouse-document-intake');
const { extractPdfTextLayer } = require('../api/_lib/pdf-text-layer');

const directory = path.join(__dirname, '../output/pdf/regresion-documental/20260906-r09');
const fixture = JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'))
  .find(document => document.tipo === 'SALIDA-3Q');
const pdf = fs.readFileSync(path.join(directory, fixture.archivo));
const objectItems = fixture.items.map(({ vencimiento, ...item }) => ({ ...item, fecha_vencimiento: vencimiento }));
const compactItems = objectItems.map(item => [item.sku, item.descripcion, item.cantidad, item.unidad]);
const header = {
  tipo_documento: 'SALIDA_BODEGA_3Q', referencia_documento: fixture.referencia,
  fecha_documento: '2026-09-06', nombre_cliente: '3Q',
};

test('3Q compact contract matches object rows and preserves six positional fields', () => {
  const objects = normalizeWarehouseDocumentInput({ ...header, items: objectItems });
  const compact = normalizeWarehouseDocumentInput({ params: { ...header, items: compactItems } });
  assert.deepEqual(compact, objects);
  assert.equal(compact.calculatedTotal, 221);
  const withLot = normalizeWarehouseDocumentInput({ ...header, items: [
    ['00001-TPBI', 'Tapa', 23, 'und', 'QA-LOTE-1', '2028-12-31'],
  ] });
  assert.equal(withLot.items[0].lot, 'QA-LOTE-1');
  assert.equal(withLot.items[0].expiryDate, '2028-12-31');
  const short = normalizeWarehouseDocumentInput({ ...header, items: [['00001-TPBI', 'Tapa', 23]] });
  assert.equal(short.items[0].lot, null);
  assert.equal(short.items[0].expiryDate, null);
});

test('3Q compact rows retain missing SKU, quantity and expiry safeguards', () => {
  for (const [row, message] of [
    [['', 'Tapa', 23, 'und'], /SKU exacto/],
    [['00001-TPBI', 'Tapa', 0, 'und'], /positiva/],
    [['00001-TPBI', 'Tapa', -1, 'und'], /positiva/],
    [['00001-TPBI', 'Tapa', 23, 'und', 'L-1', '2027-02-30'], /fecha valida/],
    [null, /item 1/],
  ]) {
    assert.throws(() => normalizeWarehouseDocumentInput({ ...header, items: [row] }), message);
  }
});

// Only draft tables are allowed: any unexpected SQL (including inventory) fails the test.
function memoryDatabase({ failNativeCatalog = false } = {}) {
  const state = { header: null, rows: [], file: null, commits: 0, rollbacks: 0 };
  const catalog = objectItems.map((item, index) => ({ id: index + 1, siigo_code: item.sku, nombre: item.descripcion }));
  return {
    state,
    async beginTransaction() {},
    async commit() { state.commits++; },
    async rollback() { state.rollbacks++; },
    async execute(query, values) {
      if (/SELECT siigo_code, nombre FROM productos/.test(query)) {
        if (failNativeCatalog) throw new Error('Simulated native evidence unavailable');
        return [catalog];
      }
      if (/SELECT id, tipo_documento/.test(query)) return [state.header ? [state.header] : []];
      if (/SELECT sku_extraido, cantidad/.test(query)) return [state.rows];
      if (/SELECT id, siigo_code, nombre/.test(query)) return [catalog.filter(product => product.siigo_code === values[0])];
      if (/SELECT sha256 FROM documento_bodega_borrador_archivos/.test(query)) return [[{ sha256: state.file[4] }]];
      if (/INSERT INTO documentos_bodega_borrador\s/.test(query)) {
        state.header = {
          id: 1, tipo_documento: values[0], referencia_documento: values[2], fecha_documento: values[3],
          total_bultos: values[9], total_unidades: values[10], sha256: values[17], estado: values[18],
          advertencias: values[16], file_count: 1,
        };
        return [{ insertId: 1 }];
      }
      if (/INSERT INTO documento_bodega_borrador_items\s/.test(query)) {
        state.rows.push({ sku_extraido: values[2], cantidad: values[4], unidad: values[5], fecha_vencimiento: values[6], lote: values[7] });
        return [{ insertId: state.rows.length }];
      }
      if (/INSERT INTO documento_bodega_borrador_archivos\s/.test(query)) {
        state.file = values;
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
}

for (const failNativeCatalog of [false, true]) {
  test(`R09 full 3Q draft registration and retry, native fallback=${failNativeCatalog}`, async t => {
    t.mock.method(global, 'fetch', async () => new Response(pdf, { status: 200 }));
    const evidence = await extractPdfTextLayer(pdf);
    const db = memoryDatabase({ failNativeCatalog });
    const args = {
      db, userId: 5, origin: 'BUILDERBOT', evidenceText: evidence.text,
      documentUrl: 'https://runtime-sessions.s3.amazonaws.com/qa-r09.pdf', documentName: fixture.archivo,
    };
    if (failNativeCatalog) {
      await assert.rejects(registerWarehouseDocumentDraft({ ...args, body: { ...header, items: compactItems } }), error => {
        assert.equal(error.status, 503);
        assert.equal(error.documentDiagnostics.status, 'CATALOG_READ_FAILED');
        return true;
      });
      assert.equal(db.state.header, null);
      assert.equal(db.state.rows.length, 0);
      assert.equal(db.state.commits, 0);
      return;
    }
    const first = await registerWarehouseDocumentDraft({ ...args, body: { ...header, items: compactItems.slice(0, -1) } });
    assert.equal(first.itemCount, 9);
    assert.equal(first.totalUnits, 221);
    assert.equal(first.estado, 'PENDIENTE_REVISION');
    assert.equal(first.extractionSource, failNativeCatalog ? 'BUILDERBOT' : 'PDF_TEXT_LAYER');
    assert.deepEqual(first.extractionDiagnostics, {
      status: failNativeCatalog ? 'CATALOG_READ_FAILED' : 'NATIVE_APPLIED',
      model_rows: 8, compact_rows: 8, native_rows: 9,
    });
    assert.deepEqual(db.state.rows, objectItems.map(item => ({
      sku_extraido: item.sku, cantidad: item.cantidad, unidad: item.unidad,
      fecha_vencimiento: item.fecha_vencimiento, lote: item.lote,
    })));
    assert.deepEqual(db.state.file[5], pdf);
    const retry = await registerWarehouseDocumentDraft({ ...args, body: { ...header, items: objectItems } });
    assert.equal(retry.duplicate, true);
    assert.equal(db.state.rows.length, 9);
    assert.equal(db.state.commits, 2);
  });
}

test('3Q rejects a changed compact retry before inserting a second draft', async () => {
  const db = memoryDatabase();
  const args = { db, userId: 5, origin: 'DASHBOARD' };
  await registerWarehouseDocumentDraft({ ...args, body: { ...header, items: compactItems } });
  const changed = compactItems.map(row => [...row]);
  changed[0][2]++;
  await assert.rejects(registerWarehouseDocumentDraft({ ...args, body: { ...header, items: changed } }), /datos operativos/);
  assert.equal(db.state.rows.length, 9);
  assert.equal(db.state.rollbacks, 1);
});

test('3Q failure diagnostics contain only status and bounded counts', async () => {
  const db = memoryDatabase();
  await assert.rejects(registerWarehouseDocumentDraft({
    db, userId: 5, body: { ...header, items: [['', 'Private description', 23]] },
  }), error => {
    assert.equal(error.status, 400);
    assert.deepEqual(error.documentDiagnostics, {
      status: 'NO_PDF', model_rows: 1, compact_rows: 1, native_rows: 0,
    });
    return true;
  });
  assert.equal(db.state.header, null);
  assert.equal(db.state.commits, 0);
});
