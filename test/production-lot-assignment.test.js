const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assignedFinishedLot } = require('../api/_lib/production-lot');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('finished-product lot is deterministic for an OP and requires its code', () => {
  assert.equal(assignedFinishedLot('OP-20260927-000103'), 'LPN-OP-20260927-000103');
  assert.equal(assignedFinishedLot(' OP-20260927-000103 '), 'LPN-OP-20260927-000103');
  assert.throws(() => assignedFinishedLot(''), /codigo/);
});

test('material confirmation and close use the same lot assignment', () => {
  const workflow = read('api/_lib/production-workflow.js');
  const close = read('api/_lib/production-close.js');
  assert.match(workflow, /const finishedLot = assignedFinishedLot\(order\.codigo_orden\)/);
  assert.match(workflow, /lpn_terminado: finishedLot, already_confirmed: true/);
  assert.match(workflow, /lpn_terminado: finishedLot, already_confirmed: false/);
  assert.match(close, /const lpn = assignedFinishedLot\(order\.codigo_orden\)/);
});

test('assigned lot is visible at production start without creating PT stock', () => {
  const workflow = read('api/_lib/production-workflow.js');
  const webhook = read('api/v1/webhook/builderbot.js');
  const listing = read('api/v1/production/index.js');
  const detail = read('api/v1/production/[id].js');
  const page = read('frontend/src/pages/ProduccionPage.jsx');
  assert.match(workflow, /Lote asignado de producto terminado: \*\$\{finishedLot\}\*/);
  assert.match(webhook, /Lote asignado de producto terminado: \*\$\{confirmation\.lpn_terminado\}\*/);
  assert.match(listing, /row\.estado === 'EN_PROCESO' && row\.materiales_conf_en/);
  assert.match(detail, /l\.production_order_id = op\.id/);
  assert.match(detail, /rows\[0\]\.estado === 'EN_PROCESO' && rows\[0\]\.materiales_conf_en/);
  assert.match(page, /Asignado · ingresa al cerrar/);
});
