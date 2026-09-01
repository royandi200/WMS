const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  groupQuantitiesByUnit,
  remainingPurchaseOrderItems,
} = require('../api/_lib/purchase-order-reception');

test('mixed purchase-order quantities remain grouped by unit', () => {
  assert.deepEqual(groupQuantitiesByUnit([
    { cantidad_ordenada: 12, unidad: 'und' },
    { cantidad_ordenada: 12, unidad: 'UND' },
    { cantidad_ordenada: 10, unidad: 'und' },
    { cantidad_ordenada: 12, unidad: 'und' },
    { cantidad_ordenada: 2000, unidad: 'gr' },
  ]), [
    { unit: 'gr', quantity: 2000 },
    { unit: 'und', quantity: 46 },
  ]);
});

test('direct reception prepares only the unaccepted purchase-order balance', () => {
  assert.deepEqual(remainingPurchaseOrderItems([
    { producto_id: 1, cantidad_ordenada: 12, unidad: 'und' },
    { producto_id: 2, cantidad_ordenada: 2000, unidad: 'gr' },
  ], [
    { producto_id: 1, cantidad_aceptada: 5 },
    { producto_id: 2, cantidad_aceptada: 2000 },
  ]), [{
    producto_id: 1,
    cantidad_ordenada: 12,
    unidad: 'und',
    cantidad_aceptada: 5,
    cantidad_pendiente: 7,
  }]);
});

test('preparing a reception is idempotent and cannot mutate inventory', () => {
  const domain = fs.readFileSync(path.join(__dirname, '../api/_lib/purchase-order-reception.js'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../database/20_direct_purchase_order_receptions.sql'), 'utf8');
  assert.match(domain, /OC_DIRECTA:\$\{orderId\}/u);
  assert.match(domain, /FOR UPDATE/u);
  assert.match(domain, /item_id: createdItem\.insertId/u);
  assert.match(domain, /ELSE LEAST\(ri\.cantidad_rec, ri\.cantidad_esp\)/u);
  assert.match(migration, /UNIQUE KEY uk_recepcion_preparacion_clave/u);
  assert.doesNotMatch(domain, /INSERT INTO (?:stock|movimientos|kardex|lots)/u);
  assert.match(route, /requireCapability\(req, CAPABILITIES\.RECEPTION_CONFIRM\)/u);
  assert.match(route, /action === 'PREPARAR_DESDE_OC'/u);
  assert.match(route, /motivo de la diferencia/u);
  assert.match(route, /La recepcion ya pertenece a otra orden de compra/u);
});

test('direct reception stays separate from outsourced 3Q receipts', () => {
  const domain = fs.readFileSync(path.join(__dirname, '../api/_lib/purchase-order-reception.js'), 'utf8');
  assert.match(domain, /modalidad_operativa === 'PT'/u);
  assert.match(domain, /orden de maquila 3Q/u);
  assert.match(domain, /modalidad_operativa === 'PR'/u);
  assert.match(domain, /orden de produccion interna/u);
});

test('dashboard starts physical reception from an open purchase order', () => {
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/RecepcionPage.jsx'), 'utf8');
  assert.match(page, /Iniciar recepcion fisica/u);
  assert.match(page, /Pendiente de la OC/u);
  assert.match(page, /Lote proveedor \(opcional\)/u);
  assert.match(page, /required=\{item\.requiresLot\}/u);
  assert.doesNotMatch(page, /Recepcion importada de Siigo/u);
  assert.doesNotMatch(page, /Factura\/compra Siigo/u);
});
