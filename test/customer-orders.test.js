const test = require('node:test');
const assert = require('node:assert/strict');
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

test('PED ID tolerates natural speech but refuses an invented or ambiguous ID', () => {
  for (const utterance of ['produce PED ID 38', 'libera el pedido 38']) {
    assert.equal(customerOrderIdFromText(utterance), 38);
  }
  assert.equal(customerOrderIdFromText('libera pedido uno'), 1);
  assert.equal(customerOrderIdFromText('produce 38 unidades'), null);
  assert.equal(reconcileCustomerOrderId({ pedido_cliente_id: 38 }, 'produce PED ID 38'), 38);
  assert.throws(() => reconcileCustomerOrderId({ pedido_cliente_id: 38 }, 'produce pedido 39'), /no coincide/u);
  assert.throws(() => reconcileCustomerOrderId({ pedido_cliente_id: 38 }, 'produce 38 unidades'), /no coincide/u);
  assert.equal(reconcileCustomerOrderItemId({ pedido_cliente_item_id: 12 }, 'PED ID 38, Item ID 12'), 12);
  assert.throws(() => reconcileCustomerOrderItemId({ pedido_cliente_item_id: 12 }, 'PED ID 38, Item ID 13'), /no coincide/u);
});

test('approval links a reviewed customer PDF without creating a supplier OC or inventory', async () => {
  const writes = [];
  const conn = { execute: async (sql, params) => {
    if (sql.includes('FROM documentos_bodega_borrador d')) return [[{
      id: 42, tipo_documento: 'ORDEN_COMPRA_CLIENTE', estado: 'PENDIENTE_REVISION',
      referencia_documento: 'Pedido 1', destinatario_nombre: 'Farmacia Central Demo',
      fecha_documento: '2026-09-23', advertencias: null, archivos: 1,
    }]];
    if (sql.includes('FROM pedidos_cliente WHERE documento_borrador_id')) return [[]];
    if (sql.includes('FROM pedidos_cliente\n')) return [[]];
    if (sql.includes('FROM documento_bodega_borrador_items i')) return [[{
      id: 1, producto_id: 102, cantidad: 3, unidad: 'und', modalidad_operativa: 'PR', activo: 1,
    }]];
    writes.push({ sql, params });
    if (sql.includes('INSERT INTO pedidos_cliente\n')) return [{ insertId: 7 }];
    return [{ affectedRows: 1 }];
  } };
  const result = await approveCustomerOrderDraft(conn, { draftId: 42, userId: 2 });
  assert.equal(result.identificador, 'PED ID 7');
  assert.equal(writes.length, 3);
  assert.ok(writes.some(({ sql }) => sql.includes('INSERT INTO pedido_cliente_items')));
  assert.ok(writes.every(({ sql }) => !/ordenes_compra_proveedor|\bstock\b|\bkardex\b/iu.test(sql)));
});
