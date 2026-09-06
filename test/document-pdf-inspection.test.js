const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { inspectStoredDocumentPdf } = require('../api/_lib/document-pdf-inspection');
const { nativePdfEvidence, safePdfFailure, pdfReviewWarning } = require('../api/_lib/document-pdf-evidence');
const fixtures = ['20260906-r09', '20260906-r10'].flatMap(run => {
  const directory = path.join(__dirname, '../output/pdf/regresion-documental', run);
  return JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'))
    .map(fixture => ({ ...fixture, directory }));
});

for (const fixture of fixtures) {
  test(`stored PDF inspection and shared recovery preserve all rows: ${fixture.referencia}`, async () => {
    const content = fs.readFileSync(path.join(fixture.directory, fixture.archivo));
    const sha256 = createHash('sha256').update(content).digest('hex');
    const db = { async execute(sql) {
      assert.match(sql.trim(), /^SELECT /);
      if (sql.includes('a.contenido')) return [[{ contenido: content, sha256, tipo_documento: fixture.tipo }]];
      assert.match(sql, /SELECT siigo_code, nombre/);
      return [fixture.items.map(item => ({ siigo_code: item.sku, nombre: item.descripcion }))];
    } };
    const result = await inspectStoredDocumentPdf(db, 18);
    assert.equal(result.diagnostics.status, 'NATIVE_APPLIED');
    assert.equal(result.pages, 2);
    assert.equal(result.sha256, sha256);
    assert.equal(result.inventory_changed, false);
    assert.equal(result.draft_changed, false);
    const fields = items => items.map(({ sku, cantidad, unidad, lote, fecha_vencimiento }) => ({ sku, cantidad, unidad, lote, fecha_vencimiento }));
    assert.deepEqual(fields(result.items), fixture.items.map(({ vencimiento, descripcion, ...item }) => ({ ...item, fecha_vencimiento: vencimiento })));
    const compact = fixture.items.slice(0, -1).map(item => [item.sku, item.descripcion, item.cantidad]);
    const recovered = await nativePdfEvidence(db, { content }, { params: { items: compact } });
    assert.deepEqual(fields(recovered.body.params.items), fields(result.items));
  });
}

test('stored PDF inspection validates ID and integrity before parsing', async () => {
  const untouched = { execute() { assert.fail('Unexpected DB query'); } };
  await assert.rejects(inspectStoredDocumentPdf(untouched, '../18'), { status: 400 });
  const missing = { async execute() { return [[]]; } };
  await assert.rejects(inspectStoredDocumentPdf(missing, 18), { status: 404 });
  const corrupt = { async execute() { return [[{ contenido: Buffer.from('bad'), sha256: 'invalid' }]]; } };
  await assert.rejects(inspectStoredDocumentPdf(corrupt, 18), { status: 409 });
});

test('native PDF read errors fail closed without exposing parser error details', async () => {
  const db = { execute() { assert.fail('Parsing must fail before catalog lookup'); } };
  await assert.rejects(nativePdfEvidence(db, { content: Buffer.from('%PDF-broken') }, { items: [] }), error => {
    assert.equal(error.status, 503);
    assert.equal(error.documentDiagnostics.status, 'PDF_PARSE_FAILED');
    assert.doesNotMatch(error.message, /Invalid PDF|node_modules|password=/);
    return true;
  });
  assert.equal(safePdfFailure(new Error('DOMMatrix is not defined')), 'PDF_CANVAS_UNAVAILABLE');
  assert.equal(safePdfFailure(new Error('Cannot find worker /private/path')), 'PDF_WORKER_UNAVAILABLE');
  assert.equal(safePdfFailure(new Error('Cannot find module /private/path')), 'PDF_MODULE_UNAVAILABLE');
  assert.equal(safePdfFailure(new Error('https://private.example/?token=secret')), 'PDF_READ_FAILED');
  assert.ok(pdfReviewWarning({ diagnostics: { status: 'NO_TEXT_LAYER' } }));
  assert.ok(pdfReviewWarning({ diagnostics: { status: 'MODEL_FALLBACK' } }));
  assert.equal(pdfReviewWarning({ diagnostics: { status: 'NATIVE_APPLIED' } }), null);
});

test('PDF inspection route denies non-admin before reading stored content', async () => {
  const dbPath = require.resolve('../api/_lib/db');
  const authPath = require.resolve('../api/_lib/auth');
  const routePath = require.resolve('../api/v1/warehouse-documents');
  const oldDb = require.cache[dbPath];
  const oldAuth = require.cache[authPath];
  try {
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
      createConnection() { assert.fail('Unauthorized PDF inspection must not read DB'); },
    } };
    require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
      cors() {}, async requireRole(req, roles) {
        assert.deepEqual(roles, ['admin', 'administrador']);
        throw Object.assign(new Error('No autorizado'), { status: 403 });
      },
    } };
    delete require.cache[routePath];
    const handler = require(routePath);
    const res = { status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method: 'GET', query: { inspect_pdf: '18' } }, res);
    assert.equal(res.code, 403);
  } finally {
    if (oldDb) require.cache[dbPath] = oldDb; else delete require.cache[dbPath];
    if (oldAuth) require.cache[authPath] = oldAuth; else delete require.cache[authPath];
    delete require.cache[routePath];
  }
});
