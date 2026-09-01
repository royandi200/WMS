const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  CAPABILITIES,
  capabilityForAction,
  hasCapability,
} = require('../api/_lib/capabilities');
const { envFlag, workflowFlags } = require('../api/_lib/feature-flags');
const { normalizePurchaseOrderInput } = require('../api/_lib/purchase-orders');
const { internalReceptionLot, normalizeReceptionDistributions } = require('../api/_lib/reception-distributions');
const { roundQty } = require('../api/_lib/production-workflow');
const { notificationsEnabled, normalizePhone, maskPhone, recipientPhones } = require('../api/_lib/builderbot-notifications');
const {
  normalizeExpiryDate,
  normalizeProductionCloseParams,
  parseProductionCloseFromText,
} = require('../api/_lib/production-close-input');

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
  assert.equal(capabilityForAction('CONSULTAR_DESPACHOS_PENDIENTES'), CAPABILITIES.DISPATCH_READ);
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

test('dashboard dispatch route enforces the direct-dispatch feature flag', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'dispatch.js'), 'utf8');
  assert.match(source, /workflowFlags\(\)\.allowDirectDispatchRequest/u);
  assert.match(source, /despacho directo esta desactivado/u);
  assert.match(source, /Math\.min\(Math\.max\(Math\.trunc\(requestedLimit\), 1\), 200\)/u);
  assert.match(source, /SELECT \* FROM despachos[\s\S]*LIMIT \$\{limit\}/u);
  assert.match(source, /new Set\(rows\.map\(\(row\) => row\.id\)\)\.size/u);
});

test('BuilderBot lists only dispatches that can actually be confirmed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'webhook', 'builderbot.js'), 'utf8');
  assert.match(source, /case 'CONSULTAR_DESPACHOS_PENDIENTES'/u);
  assert.match(source, /WHERE d\.estado = 'picking'/u);
});

test('BuilderBot lists recent production orders before historical test data', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'webhook', 'builderbot.js'), 'utf8');
  assert.match(source, /ORDER BY o\.creado_en DESC, o\.id DESC/u);
});

test('notifications route uses a validated literal LIMIT for MySQL compatibility', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'notifications.js'), 'utf8');
  assert.match(source, /Math\.min\(Math\.max\(Number\(req\.query\?\.limit/u);
  assert.match(source, /LIMIT \$\{limit\}/u);
  assert.doesNotMatch(source, /notificaciones_salida ORDER BY creado_en DESC LIMIT \?/u);
});

test('destroyed returns use a supported non-available lot status', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'returns-workflow.js'), 'utf8');
  assert.match(workflow, /return 'PENDIENTE_DISPOSICION'/u);
  assert.match(workflow, /createCustomerReturn/u);
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
    tercero_id: 25,
    proveedor_nombre: 'Proveedor QA',
    items: [{ sku: 'SKU-1', cantidad: 12, unidad: 'und' }],
  };
  const first = normalizePurchaseOrderInput(input);
  const second = normalizePurchaseOrderInput(input);
  assert.equal(first.hash, second.hash);
  assert.equal(
    first.hash,
    normalizePurchaseOrderInput({ ...input, proveedor_nombre: 'Nombre manipulado' }).hash
  );
  assert.equal(first.items[0].quantity, 12);
  assert.throws(
    () => normalizePurchaseOrderInput({ ...input, tercero_id: null }),
    /proveedor sincronizado/
  );
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

test('reception requires supplier lots only for lot-controlled products', () => {
  assert.throws(
    () => normalizeReceptionDistributions({
      distributions: [{ condicion: 'DISPONIBLE', cantidad: 2, ubicacion_id: 1 }],
    }),
    /Lote requerido/u
  );

  const internal = normalizeReceptionDistributions({
    distributions: [{ condicion: 'DISPONIBLE', cantidad: 2, ubicacion_id: 1 }],
  }, { requiresLot: false, receptionId: 60, itemId: 82 });
  assert.equal(internal.distributions[0].lot, 'RECINT-60-82-01');
  assert.equal(internal.distributions[0].internalLot, true);
  assert.equal(internalReceptionLot(60, 82, 1), 'RECINT-60-82-02');

  const supplied = normalizeReceptionDistributions({
    distributions: [{ condicion: 'DISPONIBLE', cantidad: 2, ubicacion_id: 1, lote: 'PROV-123' }],
  }, { requiresLot: false, receptionId: 60, itemId: 82 });
  assert.equal(supplied.distributions[0].lot, 'PROV-123');
  assert.equal(supplied.distributions[0].internalLot, false);
});

test('reception writes a complete movement reference and inventory kardex', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  assert.match(source, /'recepcion_siigo_import'/u);
  assert.match(source, /supplierLotProvided\s*\?\s*'Lote informado por el proveedor'/u);
  assert.match(source, /'recepcion_orden_compra'/u);
  assert.match(source, /'INGRESO_RECEPCION'/u);
  assert.match(source, /reasonsFor\(\['CUARENTENA'\]\)/u);
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

test('workflow notifications default to enabled with an emergency off switch', () => {
  const previous = process.env.DISABLE_OUTBOUND_NOTIFICATIONS;
  delete process.env.DISABLE_OUTBOUND_NOTIFICATIONS;
  assert.equal(notificationsEnabled(), true);
  process.env.DISABLE_OUTBOUND_NOTIFICATIONS = 'true';
  assert.equal(notificationsEnabled(), false);
  if (previous == null) delete process.env.DISABLE_OUTBOUND_NOTIFICATIONS;
  else process.env.DISABLE_OUTBOUND_NOTIFICATIONS = previous;
});

test('proactive notifications exclude the actor and deduplicate phones', () => {
  const rows = [
    { id: 1, telefono: '3174442659' },
    { id: 2, telefono: '3125031367' },
    { id: 3, telefono: '+57 312 503 1367' },
    { id: 4, telefono: 'invalido' },
  ];
  assert.deepEqual(recipientPhones(rows, [1]), ['573125031367']);
});

test('production start and close emit stable notification events', () => {
  const startSource = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'production-workflow.js'), 'utf8');
  const closeSource = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'production-close.js'), 'utf8');
  assert.match(startSource, /production_started:\$\{order\.id\}/u);
  assert.match(startSource, /roles: \['admin', 'recepcion_cierre'\]/u);
  assert.match(startSource, /excludeUserIds: \[userId\]/u);
  assert.match(closeSource, /production_closed:\$\{order\.id\}/u);
  assert.match(closeSource, /roles: \['admin'\]/u);
  assert.match(closeSource, /excludeUserIds: \[userId\]/u);
});

test('production close text keeps reason, location and expiry separate', () => {
  const parsed = parseProductionCloseFromText(
    'cerramos producción OP-20260804-000060 con 2 conformes y 1 merma por daño de empaque, dejar el producto terminado en PPAL-A-1-01, vence el 31 de diciembre de 2027'
  );
  assert.deepEqual(parsed.params, {
    id_orden: 'OP-20260804-000060',
    cantidad_real: 2,
    merma: 1,
    motivo_merma: 'daño de empaque',
    ubicacion: 'PPAL-A-1-01',
    fecha_venc: '2027-12-31',
  });
  assert.equal(normalizeExpiryDate('2027-02-29'), null);
  assert.equal(normalizeExpiryDate('29 de febrero de 2028'), '2028-02-29');
});

test('production close normalizes LLM aliases', () => {
  const normalized = normalizeProductionCloseParams({
    conformes: 2,
    cantidad_merma: 1,
    motivo: 'daño de empaque',
    ubicacion_codigo: 'PPAL-A-1-01',
    fecha_vencimiento: '31 de diciembre de 2027',
  });
  assert.equal(normalized.cantidad_real, 2);
  assert.equal(normalized.merma, 1);
  assert.equal(normalized.motivo_merma, 'daño de empaque');
  assert.equal(normalized.ubicacion, 'PPAL-A-1-01');
  assert.equal(normalized.fecha_venc, '2027-12-31');
  assert.equal(normalizeProductionCloseParams({ fecha_vencimiento: '2027-02-29' }).fecha_venc, '2027-02-29');
});

test('production close idempotency response includes actor and timestamp', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'webhook', 'builderbot.js'), 'utf8');
  assert.match(source, /closure\.closed_by/u);
  assert.match(source, /closure\.closed_at/u);
  assert.match(source, /No se modifico inventario/u);
});

test('purchase import does not reconcile the same document twice in one run', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/siigo/import-purchases.js'), 'utf8');
  assert.match(source, /excludedPurchaseIds\.has\(String\(reception\.siigo_purchase_id\)\)/u);
  assert.match(source, /reconcilePending\(user, fetchedPurchaseIds\)/u);
});

test('dispatch allocation requires and reports an active physical location', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/_lib/siigo.invoice-import.js'), 'utf8');
  assert.match(source, /JOIN ubicaciones u ON u\.id = s\.ubicacion_id/u);
  assert.match(source, /u\.bodega_id = s\.bodega_id AND u\.activa = 1/u);
  assert.match(source, /ubicacion: allocation\.ubicacion/u);
  assert.match(source, /\| ubicacion \$\{item\.ubicacion\}/u);
});

test('lot traceability follows returns from original lot to returned lot', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(source, /WHERE dv\.lote = \? OR dv\.lote_origen = \?/u);
  assert.match(source, /d\.estado = 'despachado' AND di\.cantidad_des > 0/u);
  assert.match(source, /Vence: \$\{formatDateOnly\(l\.expiry_date\)\}/u);
  assert.match(source, /d\.siigo_invoice_name/u);
  assert.match(source, /d\.despacho_numero/u);
  assert.match(source, /d\.referencia_externa/u);
  assert.match(source, /CONCAT\('DEVOLUCION_', dv\.estado\) AS condicion/u);
  assert.match(source, /JOIN recepciones r ON r\.id = dv\.recepcion_id/u);
  assert.match(source, /DEVOLUCION_\$\{k\.estado_devolucion\}/u);
  assert.match(source, /sin cambio en disponible/u);
});

test('BuilderBot prompt keeps the API contract and valid encoding', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '..', 'docs', 'Prompt WMS.txt'), 'utf8');
  assert.doesNotMatch(prompt, /Ã|Â|â†|�/u);
  assert.match(prompt, /`kw` debe ser exactamente `g0m@s`/u);
  assert.match(prompt, /`body`, `text` y `query` son obligatorios/u);
  for (const action of [
    'LIBERAR_ORDEN_PRODUCCION',
    'CONFIRMAR_MATERIALES_PRODUCCION',
    'AJUSTAR_MATERIALES_PRODUCCION',
    'CERRAR_ORDEN_PRODUCCION',
    'SINCRONIZAR_FACTURAS_SIIGO',
    'CONFIRMAR_DESPACHO_SIIGO',
  ]) {
    assert.notEqual(capabilityForAction(action), null, `${action} debe existir en el contrato del API`);
    assert.match(prompt, new RegExp(`\\b${action}\\b`, 'u'));
  }
  assert.match(prompt, /Sin cantidad, el WMS calcula el maximo fabricable/u);
});
