const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('B-01 vercel enruta el cambio de estado de producto antes de la ruta por id', () => {
  const { rewrites } = JSON.parse(read('vercel.json'));
  const sources = rewrites.map(rule => rule.source);
  const toggle = sources.indexOf('/api/v1/products/:id/toggle');
  const byId = sources.indexOf('/api/v1/products/:id');
  assert.ok(toggle >= 0, 'falta la ruta de toggle');
  assert.equal(rewrites[toggle].destination, '/api/v1/products/[id]/toggle');
  assert.ok(toggle < byId, 'la ruta de toggle debe ir antes de la ruta por id');
  assert.ok(toggle < sources.indexOf('/(.*)'), 'la ruta de toggle debe ir antes de la regla SPA');
});

test('B-01 el error de cambio de estado nunca queda vacio', () => {
  assert.match(read('frontend/src/store/productsStore.js'), /\|\| 'No se pudo cambiar el estado del producto'/);
});

test('B-02 la recepcion muestra el error junto al boton de aprobar', () => {
  const page = read('frontend/src/pages/RecepcionPage.jsx');
  assert.match(page, /setConfirmError\(result\.message/);
  assert.match(page, /role="alert"[^>]*>\{confirmError\}/);
});

test('B-03 la recepcion solo ofrece ubicaciones de su bodega', () => {
  const page = read('frontend/src/pages/RecepcionPage.jsx');
  assert.match(page, /setWarehouseId\(Number\(reception\.bodega_id\)/);
  assert.match(page, /Number\(location\.bodega_id\) === warehouseId/);
  assert.match(page, /receptionLocations\.map\(/);
});

test('B-04 las partidas bloqueadas conservan ubicacion y lote proveedor desde la recepcion', () => {
  const sql = read('api/v1/inventory/product/[id].js');
  assert.match(sql, /FROM recepcion_distribuciones/);
  assert.match(sql, /COALESCE\(s\.ubicacion_id, dv\.ubicacion_id, rd\.ubicacion_id\) AS ubicacion_id/);
  assert.match(sql, /rd\.lote_proveedor,/);
  assert.match(sql, /NULL AS lote_proveedor/, 'la segunda parte del UNION debe tener las mismas columnas');
});

test('B-05 el stock bajo depende del minimo configurado y no del control de Siigo', () => {
  for (const file of ['api/v1/inventory/low-stock.js', 'api/v1/inventory/summary.js']) {
    const sql = read(file);
    assert.doesNotMatch(sql, /control_stock\s*=\s*1/, file);
    assert.match(sql, /p\.stock_minimo > 0/, file);
  }
});

test('O-06 el saludo del agente no ofrece aprobaciones', () => {
  assert.doesNotMatch(read('api/v1/webhook/builderbot.js'), /trazabilidad y aprobaciones/);
});
