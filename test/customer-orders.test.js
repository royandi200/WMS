const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectDocumentTypeMarkers, assertDocumentTypeMarker } = require('../api/_lib/document-type-markers');
const { recoverWarehousePdfHeaders } = require('../api/_lib/document-pdf-headers');
const { normalizeWarehouseDocumentInput } = require('../api/_lib/warehouse-document-intake');
const { normalizePurchaseOrderDocumentInput } = require('../api/_lib/purchase-order-document-intake');
const {
  customerOrderIdFromText, reconcileCustomerOrderId, reconcileCustomerOrderItemId,
} = require('../api/_lib/customer-order-reference');
const { capabilityForAction, CAPABILITIES } = require('../api/_lib/capabilities');
const { approveCustomerOrderDraft } = require('../api/v1/customer-orders');

const customerPdfText = [
  'ORDEN DE COMPRA DEL CLIENTE',
  'Número de pedido: Pedido 1',
  'Fecha: 23 de septiembre de 2026',
  'Cliente final: Farmacia Central Demo',
  'SKU\tDESCRIPCIÓN\tCANTIDAD',
  '00102-PTASH60\tPRODUCTO TERMINADO ASHWAGANDHA X 60\t3 und',
].join('\n');

test('customer purchase order cannot be normalized as supplier reception', () => {
  assert.deepEqual(detectDocumentTypeMarkers(customerPdfText), {
    purchaseOrder: false,
    customerPurchaseOrder: true,
    outsourcingExit: false,
    outsourcingReceipt: false,
  });
  assert.throws(() => assertDocumentTypeMarker('ORDEN_COMPRA', customerPdfText), /ORDEN DE COMPRA/u);
  const recovered = recoverWarehousePdfHeaders({
    tipo_documento: 'ORDEN_COMPRA',
    items: [['00102-PTASH60', 'PRODUCTO TERMINADO ASHWAGANDHA X 60', 3, 'und']],
  }, customerPdfText);
  assert.equal(recovered.tipo_documento, 'ORDEN_COMPRA_CLIENTE');
  assert.equal(recovered.referencia_documento, 'Pedido 1');
  assert.equal(recovered.fecha_documento, '2026-09-23');
  assert.equal(recovered.nombre_cliente, 'Farmacia Central Demo');
  assert.throws(() => normalizePurchaseOrderDocumentInput(recovered, { evidenceText: customerPdfText }), /ORDEN_COMPRA/u);
  const customer = normalizeWarehouseDocumentInput(recovered, { evidenceText: customerPdfText });
  assert.equal(customer.documentType, 'ORDEN_COMPRA_CLIENTE');
  assert.equal(customer.items[0].sku, '00102-PTASH60');
  assert.equal(customer.items[0].quantity, 3);
  assert.equal(customer.items[0].unit, 'und');
});

test('document and pending-order actions stay in different workflows', () => {
  assert.equal(capabilityForAction('REGISTRAR_BORRADOR_OC_CLIENTE_DOCUMENTO'), CAPABILITIES.RECEPTION_CREATE);
  assert.equal(capabilityForAction('CONSULTAR_PEDIDOS_CLIENTE_PENDIENTES'), CAPABILITIES.PRODUCTION_RELEASE);
  assert.equal(capabilityForAction('CONSULTAR_RECEPCIONES_PENDIENTES'), CAPABILITIES.RECEPTION_READ);
});

test('a closed OP reserves only conforming units so customer shortfalls stay pending', () => {
  for (const file of ['../api/v1/customer-orders.js', '../api/_lib/production-workflow.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source,
      /SUM\(CASE WHEN estado = 'CERRADA' THEN cantidad_real ELSE cantidad_planeada END\)/u);
  }
});

test('a short customer-order answer lists selectable PED IDs instead of asking for OC reference', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(prompt, /responde solo `pedido de cliente`[\s\S]*`CONSULTAR_PEDIDOS_CLIENTE_PENDIENTES`/u);
  assert.match(prompt, /no pidas referencia ni cliente final/u);
  assert.match(webhook, /\*PED ID \$\{order\.id\}\*/u);
  assert.match(webhook, /produce el PED ID \$\{orders\[0\]\.id\}/u);
  assert.doesNotMatch(webhook, /produce el PED ID 1/u);
  assert.match(prompt, /`PEDID1`.*`pedido p e d y 1` significan `PED ID 1`/u);
});

test('PED ID tolerates natural speech but refuses an invented or ambiguous ID', () => {
  for (const utterance of [
    'produce PED ID 38', 'libera el pedido 38', 'produce PEDID38',
    'produce PED-ID-38', 'libera el pedido-38',
    'produce PED ID38', 'produce P E D I D 38', 'produce PED Y 38',
    'produce PEDY38', 'produce PED Y D 38', 'produce PEDIB38',
    'vamos a producir el pedido p e d y 38',
  ]) {
    assert.equal(customerOrderIdFromText(utterance), 38);
    assert.equal(reconcileCustomerOrderId({ pedido_cliente_id: 38 }, utterance), 38);
  }
  assert.equal(customerOrderIdFromText('libera pedido uno'), 1);
  assert.equal(customerOrderIdFromText('Vamos a producir el PEDID1'), 1);
  assert.equal(customerOrderIdFromText('vamos a producir el pedido p e d y 1'), 1);
  assert.equal(customerOrderIdFromText('produce 38 unidades'), null);
  assert.equal(customerOrderIdFromText('PEDID38-OTRO'), null);
  assert.equal(customerOrderIdFromText('OC-CLIENTE-R6-260923-001'), null);
  assert.equal(customerOrderIdFromText('produce PEDID38 o PEDID39'), null);
  assert.equal(reconcileCustomerOrderId({ pedido_cliente_id: 38 }, 'produce PED ID 38'), 38);
  assert.throws(() => reconcileCustomerOrderId({ pedido_cliente_id: 38 }, 'produce pedido 39'), /no coincide/u);
  assert.throws(() => reconcileCustomerOrderId({ pedido_cliente_id: 39 }, 'produce PEDID38'), /no coincide/u);
  assert.throws(() => reconcileCustomerOrderId({ pedido_cliente_id: 38 }, 'produce 38 unidades'), /no coincide/u);
  assert.equal(reconcileCustomerOrderItemId({ pedido_cliente_item_id: 12 }, 'PED ID 38, Item ID 12'), 12);
  assert.throws(() => reconcileCustomerOrderItemId({ pedido_cliente_item_id: 12 }, 'PED ID 38, Item ID 13'), /no coincide/u);
});

function reviewedOrder(overrides = {}) {
  return {
    referencia_documento: 'Pedido 1', cliente_nombre: 'Farmacia Central Demo',
    fecha_documento: '2026-09-23', items: [{ sku: '00102-PTASH60', cantidad: 3 }],
    confirmar_revision: true, motivo: '', ...overrides,
  };
}

function approvalConnection({ status = 'PENDIENTE_REVISION', warnings = null, extractedItems = null } = {}) {
  const writes = [];
  const conn = { execute: async (sql, params) => {
    if (sql.includes('FROM documentos_bodega_borrador d')) return [[{
      id: 42, tipo_documento: 'ORDEN_COMPRA_CLIENTE', estado: status,
      referencia_documento: 'Pedido 1', destinatario_nombre: 'Farmacia Central Demo',
      fecha_documento: '2026-09-23', advertencias: warnings, archivos: 1,
    }]];
    if (sql.includes('FROM pedidos_cliente WHERE documento_borrador_id')) return [[]];
    if (sql.includes('FROM pedidos_cliente\n')) return [[]];
    if (sql.includes('FROM documento_bodega_borrador_items i')) return [extractedItems ?? [{
      sku_extraido: '00102-PTASH60', cantidad: 3, unidad: 'und',
    }]];
    if (sql.includes('FROM productos WHERE UPPER(siigo_code)')) return [params[0] === '00102-PTASH60' ? [{
      id: 102, siigo_code: '00102-PTASH60', modalidad_operativa: 'PR',
    }] : []];
    writes.push({ sql, params });
    if (sql.includes('INSERT INTO pedidos_cliente\n')) return [{ insertId: 7 }];
    return [{ affectedRows: 1 }];
  } };
  return { conn, writes };
}

test('approval links a reviewed customer PDF without creating a supplier OC or inventory', async () => {
  const { conn, writes } = approvalConnection();
  const result = await approveCustomerOrderDraft(conn, { draftId: 42, userId: 2, review: reviewedOrder() });
  assert.equal(result.identificador, 'PED ID 7');
  assert.equal(result.corrected, false);
  assert.equal(writes.length, 4);
  assert.ok(writes.some(({ sql }) => sql.includes('INSERT INTO pedido_cliente_items')));
  assert.ok(writes.some(({ sql }) => sql.includes('INSERT INTO system_logs')));
  assert.ok(writes.every(({ sql }) => !/ordenes_compra_proveedor|\bstock\b|\bkardex\b/iu.test(sql)));
});

test('customer order corrections require a reason and preserve original evidence in the audit', async () => {
  const { conn, writes } = approvalConnection();
  const corrected = reviewedOrder({ items: [{ sku: '00102-PTASH60', cantidad: 4 }] });
  await assert.rejects(
    approveCustomerOrderDraft(conn, { draftId: 42, userId: 2, review: corrected }),
    /Explica la corrección/u
  );
  assert.equal(writes.length, 0);
  const result = await approveCustomerOrderDraft(conn, {
    draftId: 42, userId: 2, review: { ...corrected, motivo: 'Cantidad cotejada con el PDF' },
  });
  assert.equal(result.corrected, true);
  const audit = writes.find(({ sql }) => sql.includes('INSERT INTO system_logs'));
  const payload = JSON.parse(audit.params[2]);
  assert.equal(payload.before.items[0].quantity, 3);
  assert.equal(payload.after.items[0].quantity, 4);
});

test('customer order approval needs explicit PDF confirmation', async () => {
  const { conn, writes } = approvalConnection();
  await assert.rejects(
    approveCustomerOrderDraft(conn, {
      draftId: 42, userId: 2, review: reviewedOrder({ confirmar_revision: false }),
    }),
    /Confirma que revisaste/u
  );
  assert.equal(writes.length, 0);
});

test('customer order corrections cannot approve an unknown product', async () => {
  const { conn, writes } = approvalConnection();
  await assert.rejects(
    approveCustomerOrderDraft(conn, {
      draftId: 42, userId: 2,
      review: reviewedOrder({ items: [{ sku: 'SKU-DESCONOCIDO', cantidad: 3 }], motivo: 'SKU cotejado con el PDF' }),
    }),
    /no es un producto terminado/u
  );
  assert.equal(writes.length, 0);
});

test('a draft with extraction warnings can be approved only after explained review', async () => {
  const { conn, writes } = approvalConnection({
    status: 'REQUIERE_CORRECCION', warnings: JSON.stringify(['La tabla extraída está incompleta']),
  });
  await assert.rejects(
    approveCustomerOrderDraft(conn, { draftId: 42, userId: 2, review: reviewedOrder() }),
    /Explica la corrección/u
  );
  assert.equal(writes.length, 0);
  const result = await approveCustomerOrderDraft(conn, {
    draftId: 42, userId: 2,
    review: reviewedOrder({ motivo: 'Confirmé las filas con el PDF original' }),
  });
  assert.equal(result.identificador, 'PED ID 7');
});

test('reviewer can complete an OC whose PDF items were not extracted', async () => {
  const { conn } = approvalConnection({ extractedItems: [] });
  const result = await approveCustomerOrderDraft(conn, {
    draftId: 42, userId: 2,
    review: reviewedOrder({ motivo: 'Transcribí el producto del PDF original' }),
  });
  assert.equal(result.corrected, true);
});
