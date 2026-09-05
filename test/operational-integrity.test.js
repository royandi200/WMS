const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  assertApprovalActionSupported,
  isLegacyMutatingApprovalAction,
} = require('../api/_lib/approval-policy');
const { materialAdjustmentLockName } = require('../api/_lib/production-materials');
const { productionReleaseLockName } = require('../api/_lib/production-workflow');
const { buildSiigoDispatchNumber } = require('../api/_lib/siigo.invoice-import');

test('legacy approval actions fail closed instead of mutating inventory through a parallel path', () => {
  for (const action of [
    'SOLICITAR_INICIO_PRODUCCION',
    'SOLICITAR_CIERRE_PRODUCCION',
    'SOLICITAR_DESPACHO',
  ]) {
    assert.throws(
      () => assertApprovalActionSupported(action),
      error => error.status === 409 && error.code === 'LEGACY_APPROVAL_DISABLED'
    );
  }
  assert.equal(assertApprovalActionSupported('CONSULTAR_STOCK'), 'CONSULTAR_STOCK');
  assert.equal(isLegacyMutatingApprovalAction('SOLICITAR_DESPACHO'), true);
  assert.equal(isLegacyMutatingApprovalAction('CONSULTAR_STOCK'), false);

  const api = fs.readFileSync(path.join(__dirname, '../api/v1/approvals.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/AprobacionesPage.jsx'), 'utf8');
  assert.match(api, /estado_operativo: isLegacyMutatingApprovalAction/u);
  assert.match(page, /Conservada para auditoria/u);
});

test('long similar Siigo invoices produce distinct stable dispatch numbers', () => {
  const first = { id: 'id-1', name: 'FV-DEMO-QA-WA-20260904-IO-001' };
  const second = { id: 'id-2', name: 'FV-DEMO-QA-WA-20260904-PR-001' };
  assert.equal(buildSiigoDispatchNumber(first), buildSiigoDispatchNumber(first));
  assert.notEqual(buildSiigoDispatchNumber(first), buildSiigoDispatchNumber(second));
  assert.ok(buildSiigoDispatchNumber(first).length <= 30);
});

test('semantic operation locks are stable and change with inventory-relevant data', () => {
  const release = {
    userId: 1, productId: 10, quantity: 3, originType: 'STOCK_SEGURIDAD',
  };
  assert.equal(productionReleaseLockName(release), productionReleaseLockName(release));
  assert.notEqual(
    productionReleaseLockName(release),
    productionReleaseLockName({ ...release, quantity: 4 })
  );

  const adjustment = {
    userId: 2, orderId: 70, productId: 10, lot: 'LOT-1', locationId: 3,
    type: 'ENTREGA_ADICIONAL', quantity: 1,
  };
  assert.equal(materialAdjustmentLockName(adjustment), materialAdjustmentLockName(adjustment));
  assert.notEqual(
    materialAdjustmentLockName(adjustment),
    materialAdjustmentLockName({ ...adjustment, type: 'DEVOLUCION' })
  );
});

test('public health response does not expose database schema details', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/health.js'), 'utf8');
  assert.doesNotMatch(source, /information_schema|SHOW TABLES|schema_version|columnas|tablas/iu);
  assert.match(source, /status:\s*'ok'/u);
});

test('frontend recovers a stale chunk only once', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/src/main.jsx'), 'utf8');
  assert.match(source, /vite:preloadError/u);
  assert.match(source, /sessionStorage/u);
  assert.match(source, /window\.location\.reload/u);
});
