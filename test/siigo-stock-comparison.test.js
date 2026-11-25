const test = require('node:test');
const assert = require('node:assert/strict');
const { compareStock } = require('../api/_lib/siigo.stock-comparison');

test('compareStock descuenta lo facturado sin despachar y marca negativos de SIIGO', () => {
  const siigo = new Map([
    ['A', { cantidad: 18, control_stock: true, bodegas: [{ nombre: 'Principal', cantidad: 26 }, { nombre: 'Sin asignar', cantidad: -8 }] }],
    ['B', { cantidad: 10, control_stock: true, bodegas: [{ nombre: 'Principal', cantidad: 10 }] }],
    ['C', { cantidad: 5, control_stock: true, bodegas: [] }],
  ]);
  const wms = [
    { siigo_code: 'A', nombre: 'a', saldo_wms: 18, facturado_pendiente: 0 },
    { siigo_code: 'B', nombre: 'b', saldo_wms: 13, facturado_pendiente: 3 },
    { siigo_code: 'C', nombre: 'c', saldo_wms: 2, facturado_pendiente: 0 },
    { siigo_code: 'D', nombre: 'd', saldo_wms: 1, facturado_pendiente: 0 },
  ];
  const { resumen, filas } = compareStock(wms, siigo);
  const by = Object.fromEntries(filas.map((f) => [f.sku, f]));
  assert.equal(by.A.estado, 'REVISAR');
  assert.equal(by.B.estado, 'OK');
  assert.equal(by.C.estado, 'DIFERENCIA');
  assert.equal(by.C.diferencia, -3);
  assert.equal(by.D.estado, 'NO_EN_SIIGO');
  assert.equal(filas[0].sku, 'C');
  assert.deepEqual(resumen, { productos: 4, ok: 1, con_diferencia: 1, revisar: 1, no_en_siigo: 1 });
});
