const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CAPABILITIES, hasCapability } = require('../api/_lib/capabilities');
const {
  normalizeProductId,
  normalizeMinimumStock,
  normalizeConfiguredDwellDays,
} = require('../api/_lib/product-alert-settings');

test('alert settings accept bounded deterministic values', () => {
  assert.equal(normalizeProductId('12'), 12);
  assert.equal(normalizeMinimumStock('12.34567'), 12.3457);
  assert.equal(normalizeConfiguredDwellDays('90'), 90);
  assert.throws(() => normalizeProductId('1.2'), /Producto invalido/u);
  assert.throws(() => normalizeMinimumStock(''), /obligatorio/u);
  assert.throws(() => normalizeMinimumStock(-1), /stock minimo/u);
  assert.throws(() => normalizeConfiguredDwellDays(0), /permanencia/u);
  assert.throws(() => normalizeConfiguredDwellDays(3651), /permanencia/u);
});

test('only administrators can manage alert thresholds', () => {
  assert.equal(hasCapability('admin', CAPABILITIES.ALERT_SETTINGS_MANAGE), true);
  assert.equal(hasCapability('administrador', CAPABILITIES.ALERT_SETTINGS_MANAGE), true);
  for (const role of ['recepcion_cierre', 'alistador', 'despacho', 'consulta']) {
    assert.equal(hasCapability(role, CAPABILITIES.ALERT_SETTINGS_MANAGE), false, role);
  }
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/alert-settings.js'), 'utf8');
  assert.match(route, /requireRole\(req, \['Admin', 'Administrador'\]\)/u);
  assert.doesNotMatch(route, /requireCapability/u);
});

test('alert updates are audited and cannot mutate inventory balances', () => {
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/alert-settings.js'), 'utf8');
  assert.match(route, /FOR UPDATE/u);
  assert.match(route, /UPDATE productos[\s\S]*stock_minimo = \?, permanencia_max_dias = \?/u);
  assert.match(route, /Cambio de umbrales de alerta por SKU/u);
  assert.doesNotMatch(route, /UPDATE stock|INSERT INTO kardex|INSERT INTO movimientos/u);
});

test('low-stock alerts use operational availability and include zero-stock products', () => {
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/low-stock.js'), 'utf8');
  const summary = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/summary.js'), 'utf8');
  for (const source of [route, summary]) {
    assert.match(source, /FROM productos p[\s\S]*LEFT JOIN stock s/u);
    assert.match(source, /l\.status = 'DISPONIBLE'/u);
    assert.match(source, /l\.expiry_date >= CURDATE\(\)/u);
    assert.match(source, /u\.activa = 1 AND b\.activa = 1/u);
  }
});

test('dashboard keeps alert settings in an admin-only section', () => {
  const app = fs.readFileSync(path.join(__dirname, '../frontend/src/App.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../frontend/src/components/Sidebar.jsx'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/AlertSettingsPage.jsx'), 'utf8');
  assert.match(app, /path="configuracion-alertas" element=\{<AdminRoute>/u);
  assert.match(sidebar, /alert_settings\.manage', adminOnly: true/u);
  assert.match(page, /Stock minimo/u);
  assert.match(page, /Permanencia maxima/u);
});
