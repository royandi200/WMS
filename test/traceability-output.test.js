const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  balancesByMovement,
  paginateMessage,
  productionMaterialSummaries,
  productionUseSummaries,
} = require('../api/_lib/traceability-presentation');

test('lot traceability exposes production result and both waste contexts', () => {
  const webhook = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8'
  );
  assert.match(webhook, /\*Produccion \/ resultado:\*/u);
  assert.match(webhook, /\*Mermas asociadas:\*/u);
  assert.match(webhook, /uso productivo estimado/u);
  assert.match(webhook, /m\.referencia_externa \? `proceso/u);
  assert.match(webhook, /\['CIERRE_PRODUCCION', 'INGRESO_RECEPCION'\]\.includes\(k\.action\) && k\.ubicacion_codigo/u);
  assert.match(webhook, /\*Destino del material en maquila 3Q:\*/u);
  assert.match(webhook, /Lotes FEFO/u);
});

test('traceability groups duplicated material rows and never reports negative productive use', () => {
  const rows = [
    { siigo_code: 'MP-1', nombre: 'Materia', unidad: 'g', lote: 'L-1', ubicacion: 'A1', cantidad_consumida: 3, cantidad_devuelta: 0, merma_proceso: 5 },
    { siigo_code: 'MP-1', nombre: 'Materia', unidad: 'g', lote: 'L-2', ubicacion: 'A2', cantidad_consumida: 2, cantidad_devuelta: 1, merma_proceso: 5 },
  ];
  const [summary] = productionMaterialSummaries(rows);
  assert.equal(summary.netDelivered, 4);
  assert.equal(summary.processWaste, 5);
  assert.equal(summary.productiveUse, 0);
  assert.equal(summary.lots.length, 2);

  const [use] = productionUseSummaries(rows.map((row) => ({
    ...row, codigo_orden: 'OP-1', producto_final: 'PT-1',
  })));
  assert.equal(use.netDelivered, 4);
  assert.equal(use.processWaste, 5);
  assert.equal(use.productiveUse, 0);
});

test('historical lot balances are reconstructed from the current physical balance', () => {
  const balances = balancesByMovement([
    { id: 'in', qty: 5 },
    { id: 'out-1', qty: -2 },
    { id: 'out-2', qty: -1 },
  ], 2);
  assert.equal(balances.get('in'), 5);
  assert.equal(balances.get('out-1'), 3);
  assert.equal(balances.get('out-2'), 2);
});

test('long traceability output is paginated on line boundaries', () => {
  const pages = paginateMessage(['cabecera', 'a'.repeat(490), 'detalle', 'b'.repeat(490)].join('\n'), 500);
  assert.equal(pages.length, 2);
  assert.ok(pages.every((page) => page.length <= 500));
  assert.equal(pages.join('\n'), ['cabecera', 'a'.repeat(490), 'detalle', 'b'.repeat(490)].join('\n'));
});
