const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production list exposes and renders the finished-product lot', () => {
  const api = fs.readFileSync(path.join(__dirname, '../api/v1/production/index.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../frontend/src/store/productionStore.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/ProduccionPage.jsx'), 'utf8');
  assert.match(api, /l\.production_order_id = op\.id/);
  assert.doesNotMatch(api, /op\.lpn_terminado/);
  assert.match(store, /output_lot:\s+r\.lpn_terminado/);
  assert.match(page, /'Lote PT'/);
  assert.match(page, /r\.output_lot/);
});

test('alistador notification requests confirmation with the short OP ID', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../api/_lib/production-workflow.js'), 'utf8');
  assert.match(workflow, /Confirma materiales e inicio de producción para OP ID \$\{created\.insertId\}\./u);
  assert.match(workflow, /WHERE op\.id = \? OR op\.codigo_orden = \?/u);
  assert.doesNotMatch(workflow, /Confirma materiales e inicio de produccion para \$\{code\}/u);
});
