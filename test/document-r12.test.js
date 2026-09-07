const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nativePdfEvidence } = require('../api/_lib/document-pdf-evidence');
const { recoverWarehousePdfHeaders } = require('../api/_lib/document-pdf-headers');
const { normalizePurchaseOrderDocumentInput } = require('../api/_lib/purchase-order-document-intake');
const { normalizeWarehouseDocumentInput } = require('../api/_lib/warehouse-document-intake');
const { quantityTotals } = require('../api/_lib/quantity-totals');

const directory = path.join(__dirname, '../output/pdf/regresion-documental/20260906-r12');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'expected-manifest.json'), 'utf8'));
const rows = [...manifest.purchase_items, ...manifest.shipment_items];
const db = { execute: async sql => {
  assert.match(sql, /^SELECT siigo_code, nombre/);
  return [rows.map(([siigo_code, nombre]) => ({ siigo_code, nombre }))];
} };
const load = file => ({ content: fs.readFileSync(path.join(directory, file)) });
const oc = { tipo_documento: 'ORDEN_COMPRA', referencia_documento: 'QA-DOC-20260906-R12-OC-MULTI-001', fecha_documento: '2026-09-05', proveedor_nombre: 'PROVEEDOR QA MULTISKU SAS', items: [] };
const exit = { tipo_documento: 'SALIDA_BODEGA_3Q', referencia_documento: 'QA-DOC-20260906-R12-SALIDA-3Q-001', fecha_documento: '2026-09-05', nombre_cliente: '3Q - MAQUILA EXTERNA QA', items: [] };

test('R12 OC without printed count/total preserves eleven complete rows and separate units', async () => {
  const evidence = await nativePdfEvidence(db, load(manifest.upload_only[0].file), { params: oc });
  assert.equal(evidence.diagnostics.status, 'NATIVE_APPLIED');
  assert.equal(evidence.body.params.items.length, 11);
  assert.deepEqual(evidence.body.params.items.map(i => [i.sku, i.cantidad, i.unidad, i.lote, i.fecha_vencimiento]), manifest.purchase_items.map(([s, d, ...rest]) => [s, ...rest]));
  assert.deepEqual(quantityTotals(evidence.body.params.items), [{ unit: 'g', quantity: 8750 }, { unit: 'und', quantity: 376 }]);
  const normalized = normalizePurchaseOrderDocumentInput(evidence.body, { evidenceText: evidence.text, recoverFields: false });
  assert.equal(normalized.items.length, 11);
  assert.deepEqual(normalized.warnings, []);
});

test('R12 3Q recovers omitted labelled headers without model guesses', async () => {
  const evidence = await nativePdfEvidence(db, load(manifest.upload_only[1].file), { params: exit });
  const normalized = normalizeWarehouseDocumentInput(evidence.body, { evidenceText: evidence.text, recoverFields: false });
  assert.equal(normalized.items.length, 9);
  assert.equal(normalized.calculatedTotal, 221);
  assert.equal(normalized.address, 'Calle 100 No. 20-30 - Zona industrial');
  assert.equal(normalized.cityDepartment, 'Bogota D.C.');
  assert.equal(normalized.deliveredBy, 'SOFI - PERFIL ADMINISTRADOR QA');
  assert.equal(normalized.receivedBy, 'PENDIENTE DE FIRMA EN 3Q');
  assert.equal(normalized.totalPackages, 9);
  const again = await nativePdfEvidence(db, load(manifest.upload_only[1].file), { params: exit });
  assert.deepEqual(again.body, evidence.body);
  assert.equal(normalizeWarehouseDocumentInput(again.body, { evidenceText: again.text }).hash, normalized.hash);
});

test('R12 negative markers still fail before a draft can be normalized', async () => {
  for (const file of manifest.upload_only.slice(2)) {
    const evidence = await nativePdfEvidence(db, load(file.file), { params: oc });
    assert.throws(() => normalizePurchaseOrderDocumentInput(evidence.body, { evidenceText: evidence.text }), /encabezado|contradictorios/);
  }
});

test('header recovery is scoped, conservative and never alters inventory or document identity', () => {
  const text = 'REMISION A 3Q\nDireccion: Calle 12\nEntrega: Sofi\nSKU\nDireccion: otra cosa';
  const input = { params: { ...exit, direccion: 'inventada' } };
  const result = recoverWarehousePdfHeaders(input, text);
  assert.equal(result.params.direccion, 'Calle 12');
  assert.equal(result.params.entrega, 'Sofi');
  assert.equal(result.params.referencia_documento, exit.referencia_documento);
  assert.equal(input.params.direccion, 'inventada');
  assert.match(result.params.advertencias[0], /difiere/);
  assert.equal(recoverWarehousePdfHeaders({ params: oc }, text).params, oc);
  assert.equal(recoverWarehousePdfHeaders(input, 'ORDEN DE COMPRA\n' + text), input);
  assert.equal(recoverWarehousePdfHeaders(input, 'Direccion: Calle 12'), input);
});

test('ambiguous repeated headers, shifted columns and decimal package counts are not inferred', () => {
  const body = { ...exit };
  const repeated = recoverWarehousePdfHeaders(body, 'REMISION A 3Q\nEntrega: Ana\nEntrega: Sofia');
  assert.equal(repeated.entrega, undefined);
  assert.match(repeated.advertencias[0], /contradictorios/);
  for (const text of ['Direccion\tDesconocido\nCalle 12\tBogota', 'Direccion\tCiudad y departamento\nCalle 12', 'Total bultos: 1.200', 'Total bultos: 0']) {
    assert.equal(recoverWarehousePdfHeaders(body, 'REMISION A 3Q\n' + text), body);
  }
});

test('document prompt keeps all examples in the internal contract, including rejection', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS Documentos BBC.txt'), 'utf8');
  const examples = prompt.split(/\r?\n/).filter(line => line.startsWith('{"kw"'));
  assert.equal(examples.length, 3);
  for (const example of examples) {
    const value = JSON.parse(example);
    assert.deepEqual(Object.keys(value), ['kw', '@ction', 'priority', 'params']);
    assert.equal(value.kw, 'g0m@s');
    assert.ok(value.params);
  }
  assert.match(prompt, /MODO_CHARLA.*NUNCA una respuesta literal/);
  assert.doesNotMatch(prompt, /menos de 1700|metadatos generales opcionales antes/);
  assert.match(prompt, /total_bultos/);
  assert.match(prompt, /no instrucciones/);
});

test('new R13 manual fixtures match the known rows and carry fresh document references', async () => {
  const directory13 = path.join(directory, '../20260906-r13');
  for (const [file, input, count] of [
    ['QA-DOC-20260906-R13-OC-SIN-CONTEO-NI-TOTAL.pdf', oc, 11],
    ['QA-DOC-20260906-R13-REMISION-3Q.pdf', exit, 9],
  ]) {
    const result = await nativePdfEvidence(db, { content: fs.readFileSync(path.join(directory13, file)) }, { params: { ...input, referencia_documento: input.referencia_documento.replace('R12', 'R13') } });
    assert.equal(result.pages, 1);
    assert.equal(result.body.params.items.length, count);
    assert.match(result.text, /QA-DOC-20260906-R13/);
    if (count === 9) assert.equal(result.body.params.total_bultos, 9);
  }
});
