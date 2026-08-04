const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPABILITIES,
  capabilityForAction,
  hasCapability,
} = require('../api/_lib/capabilities');
const { envFlag, workflowFlags } = require('../api/_lib/feature-flags');
const { normalizePurchaseOrderInput } = require('../api/_lib/purchase-orders');
const { normalizeReceptionDistributions } = require('../api/_lib/reception-distributions');
const { roundQty } = require('../api/_lib/production-workflow');
const { notifyRoles, normalizePhone, maskPhone } = require('../api/_lib/builderbot-notifications');

test('admin has every capability', () => {
  assert.equal(hasCapability('admin', CAPABILITIES.USERS_MANAGE), true);
  assert.equal(hasCapability('Admin', 'unknown.future.capability'), true);
});

test('workflow roles use least privilege', () => {
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.RECEPTION_CONFIRM), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.PRODUCTION_CLOSE), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.DISPATCH_CONFIRM), false);
  assert.equal(hasCapability('alistador', CAPABILITIES.PRODUCTION_PICK), true);
  assert.equal(hasCapability('alistador', CAPABILITIES.PRODUCTION_RELEASE), false);
  assert.equal(hasCapability('despacho', CAPABILITIES.DISPATCH_CONFIRM), true);
  assert.equal(hasCapability('despacho', CAPABILITIES.APPROVALS_DECIDE), false);
});

test('unknown and read-only roles cannot mutate inventory', () => {
  assert.equal(hasCapability('consulta', CAPABILITIES.INVENTORY_READ), true);
  assert.equal(hasCapability('consulta', CAPABILITIES.INVENTORY_ADJUST), false);
  assert.equal(hasCapability('unknown', CAPABILITIES.INVENTORY_READ), false);
});

test('BuilderBot actions map to stable capabilities', () => {
  assert.equal(capabilityForAction('CONFIRMAR_MATERIALES_PRODUCCION'), CAPABILITIES.PRODUCTION_PICK);
  assert.equal(capabilityForAction('CERRAR_ORDEN_PRODUCCION'), CAPABILITIES.PRODUCTION_CLOSE);
  assert.equal(capabilityForAction('CONFIRMAR_DESPACHO_SIIGO'), CAPABILITIES.DISPATCH_CONFIRM);
  assert.equal(capabilityForAction('APROBAR_SOLICITUD'), CAPABILITIES.APPROVALS_DECIDE);
  assert.equal(capabilityForAction('not-an-action'), null);
});

test('risky workflow features are disabled by default', () => {
  const names = [
    'ALLOW_PARTIAL_DISPATCH',
    'ENABLE_BACKORDER_ALERTS',
    'AUTO_RELEASE_STALE_RESERVATIONS',
    'RESERVE_AVAILABLE_ON_SHORTAGE',
    'REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT',
    'ALLOW_SPLIT_PRODUCTION_LINE',
    'ALLOW_DIRECT_DISPATCH_REQUEST',
    'ALLOW_MANUAL_RECEPTION',
  ];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const flags = workflowFlags();
  assert.equal(flags.allowPartialDispatch, false);
  assert.equal(flags.enableBackorderAlerts, false);
  assert.equal(flags.autoReleaseStaleReservations, false);
  assert.equal(flags.reserveAvailableOnShortage, true);
  assert.equal(flags.requirePurchaseOrderForSiigoReceipt, true);
  assert.equal(flags.allowSplitProductionLine, false);
  assert.equal(flags.allowDirectDispatchRequest, false);
  assert.equal(flags.allowManualReception, false);
  for (const name of names) {
    if (saved[name] == null) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

test('environment flag parsing is explicit', () => {
  process.env.TEST_WMS_FLAG = 'yes';
  assert.equal(envFlag('TEST_WMS_FLAG'), true);
  process.env.TEST_WMS_FLAG = 'false';
  assert.equal(envFlag('TEST_WMS_FLAG', true), false);
  delete process.env.TEST_WMS_FLAG;
});

test('purchase order normalization is deterministic and validates quantities', () => {
  const input = {
    numero: 'OC-100',
    proveedor_nombre: 'Proveedor QA',
    items: [{ sku: 'SKU-1', cantidad: 12, unidad: 'und' }],
  };
  const first = normalizePurchaseOrderInput(input);
  const second = normalizePurchaseOrderInput(input);
  assert.equal(first.hash, second.hash);
  assert.equal(first.items[0].quantity, 12);
  assert.throws(
    () => normalizePurchaseOrderInput({ ...input, items: [{ sku: 'SKU-1', cantidad: 0 }] }),
    /Cantidad invalida/
  );
});

test('reception distributions separate available and blocked inventory', () => {
  const result = normalizeReceptionDistributions({
    qty_received: 10,
    distributions: [
      { condicion: 'buena', cantidad: 7, lote: 'LOT-A', ubicacion_id: 1 },
      { condicion: 'cuarentena', cantidad: 2, lote: 'LOT-Q', ubicacion_id: 2, motivo: 'Revision de calidad' },
      { condicion: 'desechada', cantidad: 1, lote: 'LOT-R', motivo: 'Empaque roto' },
    ],
  });
  assert.equal(result.totals.received, 10);
  assert.equal(result.totals.DISPONIBLE, 7);
  assert.equal(result.totals.CUARENTENA, 2);
  assert.equal(result.totals.PENDIENTE_DISPOSICION, 1);
  assert.throws(
    () => normalizeReceptionDistributions({
      qty_received: 9,
      distributions: [{ condicion: 'buena', cantidad: 10, lote: 'LOT-A', ubicacion_id: 1 }],
    }),
    /no coincide/
  );
});

test('production quantities are rounded consistently', () => {
  assert.equal(roundQty(0.1 + 0.2), 0.3);
  assert.equal(roundQty(3.141592), 3.1416);
});

test('BuilderBot phone normalization is deterministic and masked in results', () => {
  assert.equal(normalizePhone('317 444 2659'), '573174442659');
  assert.equal(normalizePhone('+57 312 503 1367'), '573125031367');
  assert.equal(normalizePhone('123'), null);
  assert.equal(maskPhone('573174442659'), '5731******59');
});

test('workflow notifications are opt-in', async () => {
  const previous = process.env.ENABLE_WORKFLOW_NOTIFICATIONS;
  delete process.env.ENABLE_WORKFLOW_NOTIFICATIONS;
  const result = await notifyRoles({ event: 'test', roles: ['admin'], text: 'test' });
  assert.deepEqual(result, [{ status: 'disabled' }]);
  if (previous == null) delete process.env.ENABLE_WORKFLOW_NOTIFICATIONS;
  else process.env.ENABLE_WORKFLOW_NOTIFICATIONS = previous;
});
