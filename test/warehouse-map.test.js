const assert = require('node:assert/strict');
const test = require('node:test');
const manifest = require('../database/warehouse_positions_master.json');
const { assignmentsByLocation, manifestAssignments } = require('../api/_lib/warehouse-map');

test('warehouse map exposes every documented product assignment', () => {
  const documented = manifestAssignments(manifest);
  assert.equal(documented.length, 101);
  assert.equal(documented.some(item => item.location === 'D7'), false);
  assert.equal(documented.some(item => item.location === 'D8' && item.documentedSku === '00126-PTLUM'), true);
});

test('warehouse map preserves document references and enriches known products', () => {
  const grouped = assignmentsByLocation({
    manifest,
    catalogProducts: [
      { id: 76, siigo_code: '00276-PTZNASHWA', nombre: 'ZENOVA ASHWAGANDHA', modalidad_operativa: 'IO' },
    ],
    linkedAssignments: [
      { ubicacion_codigo: 'B13', siigo_code: '00276-PTZNASHWA' },
    ],
  });
  const zenova = grouped.get('B13').find(item => item.sku === '00276-PTZNASHWAB');
  assert.equal(zenova.sku_catalogo, '00276-PTZNASHWA');
  assert.equal(zenova.nombre, 'ZENOVA ASHWAGANDHA');
  assert.equal(zenova.vinculada_catalogo, true);
  const unknown = grouped.get('D10').find(item => item.sku === '00284-SEP');
  assert.equal(unknown.producto_id, null);
  assert.equal(unknown.nombre, 'Referencia asignada en plano');
});

test('warehouse manifest is scoped to the main warehouse', () => {
  assert.equal(manifest.warehouse_code, 'BG-PPAL');
});
