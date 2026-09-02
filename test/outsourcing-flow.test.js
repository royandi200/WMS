const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_PDF_BYTES,
  normalizePurchaseOrderPdf,
  safeDownloadName,
} = require('../api/_lib/purchase-order-documents');
const {
  normalizeOutsourcingOrderInput,
  normalizeAdditionalShipmentInput,
  outsourcingStateForReceipt,
} = require('../api/_lib/outsourcing-domain');
const { CAPABILITIES, hasCapability } = require('../api/_lib/capabilities');

function pdfPayload(content = '%PDF-1.7\n%%EOF') {
  return {
    documento_pdf: {
      nombre: 'OC-3Q.pdf',
      mime_type: 'application/pdf',
      base64: Buffer.from(content).toString('base64'),
    },
  };
}

test('purchase order PDF validates signature and produces a stable hash', () => {
  const first = normalizePurchaseOrderPdf(pdfPayload());
  const second = normalizePurchaseOrderPdf(pdfPayload());
  assert.equal(first.name, 'OC-3Q.pdf');
  assert.equal(first.mimeType, 'application/pdf');
  assert.equal(first.hash, second.hash);
  assert.equal(first.content.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('purchase order PDF rejects disguised and oversized files', () => {
  assert.throws(
    () => normalizePurchaseOrderPdf({ documento_pdf: { nombre: 'oc.pdf', mime_type: 'application/pdf', base64: Buffer.from('not a pdf').toString('base64') } }),
    /firma PDF valida/u
  );
  const oversized = Buffer.alloc(MAX_PDF_BYTES + 1, 0x20);
  oversized.write('%PDF-', 0, 'ascii');
  assert.throws(
    () => normalizePurchaseOrderPdf({ documento_pdf: { nombre: 'oc.pdf', mime_type: 'application/pdf', base64: oversized.toString('base64') } }),
    /supera el limite/u
  );
});

test('download names cannot inject headers or paths', () => {
  assert.equal(safeDownloadName('..\\bad\r\nname".pdf'), '.._bad__name_.pdf');
});

test('outsourcing order input requires a purchase order and positive target', () => {
  assert.deepEqual(
    normalizeOutsourcingOrderInput({ orden_compra_id: 7, sku: '00105-PTBOS60', cantidad_objetivo: 12 }),
    { purchaseOrderId: 7, product: '00105-PTBOS60', quantity: 12, notes: null }
  );
  assert.throws(() => normalizeOutsourcingOrderInput({ sku: '00105-PTBOS60', cantidad_objetivo: 12 }), /orden_compra_id/u);
  assert.throws(() => normalizeOutsourcingOrderInput({ orden_compra_id: 7, sku: '00105-PTBOS60', cantidad_objetivo: 0 }), /positiva/u);
});

test('additional material requires reason and idempotency key', () => {
  const result = normalizeAdditionalShipmentInput({
    orden_maquila_id: 'MQ-3Q-1',
    sku: '00006-TRP',
    cantidad: 2,
    motivo: 'Reposicion por producto no conforme',
    clave_idempotencia: 'test-key-1',
  });
  assert.equal(result.idempotencyKey, 'test-key-1');
  assert.throws(() => normalizeAdditionalShipmentInput({ orden_maquila_id: 1, sku: '00006-TRP', cantidad: 2, motivo: 'x' }), /clave_idempotencia/u);
});

test('outsourcing receipt state remains partial until accepted target is reached', () => {
  assert.equal(outsourcingStateForReceipt(0, 10), 'EN_3Q');
  assert.equal(outsourcingStateForReceipt(9.999, 10), 'RECIBIDA_PARCIAL');
  assert.equal(outsourcingStateForReceipt(10, 10), 'COMPLETADA');
  assert.equal(outsourcingStateForReceipt(11, 10), 'COMPLETADA');
});

test('3Q authorization is least privilege', () => {
  assert.equal(hasCapability('admin', CAPABILITIES.OUTSOURCING_MANAGE), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.OUTSOURCING_RECEIVE), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.OUTSOURCING_MANAGE), false);
  assert.equal(hasCapability('alistador', CAPABILITIES.OUTSOURCING_MANAGE), false);
});

test('3Q writes retain transactions, idempotency and internal source location', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/_lib/outsourcing-workflow.js'), 'utf8');
  assert.match(source, /beginTransaction\(\)/u);
  assert.match(source, /already_confirmed/u);
  assert.match(source, /clave_idempotencia/u);
  assert.match(source, /ubicacion_origen_id/u);
  assert.doesNotMatch(source, /bodega_3q_id|ubicacion_3q_id/u);
  assert.match(source, /maquila_envio_3q/u);
  assert.match(source, /ENVIO_MAQUILA_3Q/u);
});

test('3Q reception is mapped per product instead of one order per invoice', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../database/16_purchase_order_documents_and_outsourcing.sql'), 'utf8');
  const reception = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS maquila_recepciones/u);
  assert.match(migration, /UNIQUE KEY uk_maquila_recepcion_producto \(recepcion_id, producto_id\)/u);
  assert.match(reception, /input\.orden_maquila_id/u);
  assert.match(reception, /modalidad_operativa === PRODUCT_MODES\.OUTSOURCED/u);
});

test('3Q reception can be prepared from an active outsourcing order without Siigo', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../api/_lib/outsourcing-workflow.js'), 'utf8');
  const reception = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/RecepcionPage.jsx'), 'utf8');
  assert.match(workflow, /async function prepareOutsourcingReception/u);
  assert.match(workflow, /\['EN_3Q', 'RECIBIDA_PARCIAL'\]/u);
  assert.match(workflow, /MAQUILA_3Q:\$\{order\.id\}/u);
  assert.match(workflow, /La cantidad de esta entrega supera el saldo pendiente/u);
  assert.match(reception, /action === 'PREPARAR_DESDE_MAQUILA'/u);
  assert.match(page, /Producto desde 3Q/u);
  assert.match(page, /orden_maquila_id: item\.outsourcingOrderId/u);
});

test('purchase orders fail closed to active Siigo suppliers', () => {
  const purchaseOrders = fs.readFileSync(path.join(__dirname, '../api/v1/purchase-orders.js'), 'utf8');
  const suppliers = fs.readFileSync(path.join(__dirname, '../api/v1/suppliers.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '../api/_lib/outsourcing-workflow.js'), 'utf8');
  for (const source of [purchaseOrders, suppliers]) {
    assert.match(source, /tipo = 'Supplier'/u);
    assert.match(source, /activo = 1/u);
    assert.match(source, /siigo_id IS NOT NULL/u);
  }
  assert.match(workflow, /no tiene un proveedor sincronizado/u);
});
