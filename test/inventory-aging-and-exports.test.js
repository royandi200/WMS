const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { normalizeDwellDays } = require('../api/_lib/inventory-aging');

test('warehouse dwell thresholds are deterministic and bounded', () => {
  assert.equal(normalizeDwellDays(undefined, undefined), 90);
  assert.equal(normalizeDwellDays('60'), 60);
  assert.equal(normalizeDwellDays('0'), 1);
  assert.equal(normalizeDwellDays('99999'), 3650);
  assert.equal(normalizeDwellDays('invalid'), 90);
});

test('warehouse dwell alert uses lot age and only inventory with physical balance', () => {
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/aging.js'), 'utf8');
  const summary = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/summary.js'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '../api/_lib/inventory-aging.js'), 'utf8');
  assert.match(route, /requireAuth\(req\)/u);
  assert.match(route, /DATEDIFF\(CURDATE\(\), DATE\(l\.created_at\)\) >= p\.permanencia_max_dias/u);
  assert.match(route, /p\.permanencia_max_dias AS dias_limite/u);
  assert.match(route, /l\.qty_current > 0/u);
  assert.match(route, /l\.status NOT IN \('DESPACHADO', 'AGOTADO'\)/u);
  assert.match(summary, /permanencia_alertas/u);
  assert.match(helper, /DEFAULT_DWELL_DAYS = 90/u);
});

test('dispatch sheet contains traceable fields and escapes untrusted values', async () => {
  const moduleUrl = pathToFileURL(path.join(__dirname, '../frontend/src/utils/dispatchSheet.js')).href;
  const { buildDispatchCsv, buildDispatchSheetHtml } = await import(moduleUrl);
  const dispatch = {
    numero: 'DSP-001',
    siigo_invoice_name: 'FV-001',
    cliente_nombre: '<script>alert(1)</script>',
    estado: 'picking',
    creado_en: '2026-09-05T10:00:00',
    items: [{ sku: 'SKU-1', producto_nombre: 'Producto', lote: 'LOT-1', ubicacion: 'B13', cantidad: 2 }],
  };
  const html = buildDispatchSheetHtml(dispatch);
  assert.match(html, /DSP-001/u);
  assert.match(html, /FV-001/u);
  assert.match(html, /LOT-1/u);
  assert.match(html, /B13/u);
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  const csv = buildDispatchCsv(dispatch);
  assert.match(csv, /"Despacho","Factura","Cliente"/u);
  assert.match(csv, /"DSP-001","FV-001"/u);
});

test('dispatch CSV remains implemented without being exposed in the dashboard', () => {
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/DespachoPage.jsx'), 'utf8');
  const utility = fs.readFileSync(path.join(__dirname, '../frontend/src/utils/dispatchSheet.js'), 'utf8');
  assert.doesNotMatch(page, /downloadDispatchCsv|>\s*CSV\s*</u);
  assert.match(utility, /export function buildDispatchCsv/u);
  assert.match(utility, /export function downloadDispatchCsv/u);
});

test('selected warehouse location gets a readable responsive detail panel', () => {
  const map = fs.readFileSync(path.join(__dirname, '../frontend/src/components/MapaBodega.jsx'), 'utf8');
  assert.match(map, /minmax\(400px,0\.85fr\)/u);
  assert.match(map, /max-h-\[58vh\]/u);
  assert.match(map, /break-all font-mono/u);
  assert.doesNotMatch(map, /shrink-0 w-64 bg-surface/u);
});

test('all receipt channels require physical lot, expiry and location', () => {
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  const whatsapp = fs.readFileSync(path.join(__dirname, '../api/_lib/builderbot-reception.js'), 'utf8');
  assert.match(route, /requiere cantidad, condicion, lote, vencimiento y ubicacion/u);
  assert.match(route, /FROM lots WHERE lpn = \? LIMIT 1 FOR UPDATE/u);
  assert.match(route, /qty_initial = qty_initial \+ \?/u);
  assert.match(whatsapp, /Falta el lote del proveedor/u);
  assert.match(whatsapp, /Falta el vencimiento/u);
  assert.match(whatsapp, /Falta la ubicacion/u);
});
