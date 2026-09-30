const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPendingReceptionsMessage, MAX_MESSAGE_CHARS } = require('../api/_lib/pending-receptions-message');

const formatDateOnly = () => '30/9/2026';

test('pending receptions show compact order identity, not each SKU detail', () => {
  const available = [47, 48, 49].map((id, index) => ({
    id, numero: `OC-PROV-20260930-00${index + 1}`,
    proveedor_nombre: 'Proveedor sincronizado', fecha_orden: '2026-09-30',
    estado: 'CARGADA', tipo_recepcion: 'INSUMOS_MP',
    items: Array.from({ length: index + 3 }, (_, item) => ({
      sku: `SKU-${item}`, producto: `Producto ${item}`, cantidad_pendiente: 2160,
      unidad: 'g',
    })),
  }));
  const result = buildPendingReceptionsMessage({ available, formatDateOnly });
  assert.match(result.message, /OC ID 47 \| OC-PROV-20260930-001 \| Proveedor sincronizado \| 3 SKU/u);
  assert.match(result.message, /OC ID 49 \| OC-PROV-20260930-003 .* 5 SKU/u);
  assert.match(result.message, /Prepara OC ID 47/u);
  assert.doesNotMatch(result.message, /SKU-0|Producto 0|Vencimiento requerido|2160 g/u);
  assert.equal(result.shownAvailable.length, 3);
  assert.ok(result.message.length <= MAX_MESSAGE_CHARS);
});

test('pending receptions stay bounded with many long orders and keep MQ identifiable', () => {
  const available = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1, numero: `OC-${'X'.repeat(55)}${index}`,
    proveedor_nombre: 'P'.repeat(150), fecha_orden: '2026-09-30',
    estado: 'CARGADA', tipo_recepcion: 'INSUMOS_MP',
    items: Array.from({ length: 20 }, () => ({ sku: 'SKU', producto: 'Un producto largo' })),
  }));
  const outsourcing = [{ id: 99, codigo: 'MQ-20260930-99', proveedor_nombre: '3Q',
    sku: '00105-PTBOS60', cantidad_pendiente: 4, unidad: 'und' }];
  const result = buildPendingReceptionsMessage({ available, outsourcing, formatDateOnly });
  assert.ok(result.message.length <= MAX_MESSAGE_CHARS);
  assert.ok(result.shownAvailable.length + result.shownOutsourcing.length <= 10);
  assert.match(result.message, /MQ ID 99 \| MQ-20260930-99/u);
  assert.match(result.message, /Hay más órdenes pendientes/u);
});

test('outsourcing-only pending list gives a typed MQ example', () => {
  const outsourcing = [{ id: 4, codigo: 'MQ-3Q-000004', proveedor_nombre: '3Q',
    sku: '00105-PTBOS60', cantidad_pendiente: 3, unidad: 'und' }];
  const result = buildPendingReceptionsMessage({ outsourcing, formatDateOnly });
  assert.match(result.message, /MQ ID 4 \| MQ-3Q-000004/u);
  assert.match(result.message, /Prepara la recepción MQ ID 4 por 3 und/u);
  assert.equal(result.shownOutsourcing.length, 1);
});
