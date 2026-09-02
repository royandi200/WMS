const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const endpoint = fs.readFileSync(path.join(__dirname, '../api/v1/inventory/product/[id].js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/InventarioPage.jsx'), 'utf8');

test('product inventory endpoint returns recent parameterized Kardex movements', () => {
  assert.match(endpoint, /FROM kardex k/u);
  assert.match(endpoint, /WHERE k\.product_id = \?/u);
  assert.match(endpoint, /ORDER BY k\.created_at DESC, k\.id DESC/u);
  assert.match(endpoint, /LIMIT 20/u);
  assert.match(endpoint, /movements,/u);
});

test('product search renders movement date, quantity, lot, reference and lot balance', () => {
  assert.match(page, /Movimientos recientes/u);
  for (const label of ['Fecha y hora', 'Cantidad', 'Lote', 'Referencia', 'Saldo del lote']) {
    assert.match(page, new RegExp(label, 'u'));
  }
  assert.match(page, /CONSUMO_MATERIAL: 'Consumo de produccion'/u);
  assert.match(page, /AJUSTE_MANUAL: 'Ajuste manual'/u);
  assert.match(page, /timeZone: 'America\/Bogota'/u);
});
