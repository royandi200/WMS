const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('3Q outbound is exposed through dispatch with its existing atomic confirmation', () => {
  const route = read('api', 'v1', 'dispatch.js');
  const page = read('frontend', 'src', 'pages', 'DespachoPage.jsx');
  assert.match(route, /'MAQUILA_3Q'/u);
  assert.match(route, /confirmOutsourcingShipment/u);
  assert.match(page, /Segunda confirmacion obligatoria/u);
});

test('post-demo inventory views expose custody, location, SKU and full lot history', () => {
  const productRoute = read('api', 'v1', 'inventory', 'product', '[id].js');
  const lotRoute = read('api', 'v1', 'inventory', 'lot', '[lpn].js');
  const kardexPage = read('frontend', 'src', 'pages', 'KardexPage.jsx');
  assert.match(productRoute, /en_custodia_3q/u);
  assert.match(lotRoute, /FROM kardex k/u);
  assert.match(kardexPage, /'SKU', 'Producto', 'Lote', 'Ubicacion'/u);
  assert.doesNotMatch(kardexPage, /slice\(0, 24\)/u);
});

test('production list exposes OP IDs and reconciled waste details', () => {
  const route = read('api', 'v1', 'production', 'index.js');
  const page = read('frontend', 'src', 'pages', 'ProduccionPage.jsx');
  assert.match(route, /FROM mermas m/u);
  assert.match(page, /OP ID \{r\.id\}/u);
  assert.match(page, /merma\.registrado_por/u);
  assert.match(page, /merma\.creado_en/u);
});
