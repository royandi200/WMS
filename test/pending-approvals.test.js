const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPendingApprovals } = require('../api/_lib/pending-approvals');

test('groups pending approvals by operational type with details', () => {
  const result = formatPendingApprovals([
    {
      codigo_solicitud: 'REQ-1', accion: 'SOLICITAR_CIERRE_PRODUCCION',
      payload: JSON.stringify({ id_orden: 'OP-1', cantidad_real: 2 }), operario: 'Juan',
    },
    {
      codigo_solicitud: 'REQ-2', accion: 'SOLICITAR_DESPACHO',
      payload: { id_item: 'SKU-1', cantidad: 3, cliente_destino: 'Cliente QA' }, operario: 'Juan',
    },
  ]);
  assert.match(result, /Cierre de produccion \(1\):/u);
  assert.match(result, /REQ-1 \| Cantidad: 2 \| Orden: OP-1/u);
  assert.match(result, /Despachos \(1\):/u);
  assert.match(result, /REQ-2 \| Producto: SKU-1 \| Cantidad: 3 \| Cliente: Cliente QA/u);
});

test('returns an explicit empty state', () => {
  assert.match(formatPendingApprovals([]), /No hay solicitudes pendientes/u);
});
