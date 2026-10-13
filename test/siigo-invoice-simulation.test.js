const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const resolve = (...parts) => path.resolve(__dirname, '..', ...parts);
const mock = (file, exports) => {
  const id = resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

const writes = [];
mock('api/_lib/db.js', {
  query: async (sql, params = []) => {
    if (!/^\s*SELECT/iu.test(sql)) { writes.push(sql); return { affectedRows: 0 }; }
    if (/FROM productos/u.test(sql)) return [
      { id: 6, siigo_code: '00102-PTASH60', nombre: 'Ashwagandha x 60' },
      { id: 9, siigo_code: 'ENVIO', nombre: 'Envío' },
    ].filter(row => params.includes(row.siigo_code));
    if (/FROM lots WHERE product_id/u.test(sql)) return [{ product_id: 6 }];
    if (/FROM stock s/u.test(sql)) return [{ producto_id: 6, disponible: 3 }];
    if (/FROM despachos/u.test(sql)) return params.includes('inv-old') ? [{ siigo_invoice_id: 'inv-old', numero: 'DSP-1', estado: 'despachado' }] : [];
    if (/FROM bodegas/u.test(sql)) return [];
    if (/FROM terceros/u.test(sql)) return params.includes('900') ? [{ id: 1 }] : [];
    return [];
  },
  createConnection: async () => { throw new Error('el simulador no debe abrir transacciones'); },
});
const invoice = (id, extra) => ({ id, name: `FV-${id}`, date: '2026-10-06', customer: { identification: '900' }, ...extra });
mock('api/_lib/siigo.service.js', {
  siigoGet: async () => ({ results: [
    invoice('ok', { items: [{ code: '00102-PTASH60', quantity: 2, warehouse: { id: 1 } }] }),
    invoice('short', { date: '2026-10-07', items: [{ code: '00102-PTASH60', quantity: 2, warehouse: { id: 1 } }] }),
    invoice('client', { customer: { identification: '111' }, items: [{ code: '00102-PTASH60', quantity: 0.5, warehouse: { id: 1 } }] }),
    invoice('ship', { items: [{ code: 'ENVIO', quantity: 1, warehouse: { id: 1 } }] }),
    invoice('new', { items: [{ code: 'NUEVO', quantity: 1, warehouse: { id: 1 } }] }),
    invoice('bod', { items: [{ code: '00102-PTASH60', quantity: 0.1, warehouse: { id: 3 } }] }),
    invoice('inv-old', { items: [{ code: '00102-PTASH60', quantity: 1, warehouse: { id: 1 } }] }),
    invoice('nula', { annulled: true, items: [{ code: '00102-PTASH60', quantity: 1, warehouse: { id: 1 } }] }),
  ], pagination: { total_pages: 1 } }),
});

const { simulateInvoices } = require('../api/_lib/siigo.invoice-simulation');

test('el simulador clasifica cada factura real sin escribir nada', async () => {
  const data = await simulateInvoices({ dateStart: '2026-10-05', dateEnd: '2026-10-13', importStart: '2026-10-05' });
  const byId = Object.fromEntries(data.facturas.map(row => [row.siigo_invoice_id, row]));
  const codes = (id) => byId[id].problemas.map(issue => issue.code);

  assert.equal(byId.ok.veredicto, 'PASARIA');
  assert.deepEqual(codes('short'), ['SIN_STOCK'], 'el stock se consume en orden de factura');
  assert.ok(codes('client').includes('CLIENTE_NO_SINCRONIZADO'));
  assert.deepEqual(codes('ship'), ['SIN_INVENTARIO_NUNCA']);
  assert.deepEqual(codes('new'), ['PRODUCTO_NO_SINCRONIZADO']);
  assert.ok(codes('bod').includes('BODEGA_NO_HABILITADA'));
  assert.equal(byId['inv-old'].veredicto, 'YA_IMPORTADA');
  assert.equal(byId.nula.veredicto, 'IGNORADA');
  assert.equal(writes.length, 0, 'no ejecuta INSERT/UPDATE/DELETE');
});
