const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const resolve = (...parts) => path.resolve(__dirname, '..', ...parts);
const mock = (file, exports) => {
  const id = resolve(file);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};

const state = { recordResult: true, cursorWrites: [], recorded: [], resolved: [] };

mock('api/_lib/db.js', {
  query: async (sql, params = []) => {
    if (/clave = 'invoices_import_cursor'/u.test(sql) && /^\s*SELECT/u.test(sql)) return [{ valor: '2026-10-05T10:00:00.000Z' }];
    if (/invoices_import_cursor/u.test(sql)) { state.cursorWrites.push(params[0]); return { affectedRows: 1 }; }
    if (/FROM usuarios u/u.test(sql)) return [{ id: 1, nombre: 'Sistema', rol: 'admin' }];
    if (/invoices_completed_reconcile_at/u.test(sql)) return [{ valor: new Date().toISOString() }];
    if (/FROM despachos/u.test(sql)) return [];
    return [];
  },
  createConnection: async () => { throw new Error('no se espera conexión'); },
});
mock('api/_lib/siigo.service.js', {
  siigoGet: async (url) => {
    if (url === '/v1/invoices') return { results: [{ id: 'inv-1', name: 'FV-1-900', date: '2026-10-05', metadata: { created: '2026-10-05T11:00:00Z' } }] };
    return { id: 'inv-1', name: 'FV-1-900', date: '2026-10-05', items: [{ code: 'NUEVO-1', quantity: 1 }], customer: { identification: '900' } };
  },
});
mock('api/_lib/siigo.invoice-import.js', {
  importInvoice: async () => { throw Object.assign(new Error('Productos no sincronizados: NUEVO-1'), { status: 409 }); },
  cancelImportedInvoice: async () => ({}),
  invoiceSignature: () => [],
});
mock('api/_lib/siigo.invoice-issues.js', {
  issuesDueForRetry: async () => [],
  recordInvoiceIssue: async (invoice, error) => {
    state.recorded.push([invoice.id, error.message]);
    if (!state.recordResult) throw new Error('db caída');
    return true;
  },
  resolveInvoiceIssue: async (id) => { state.resolved.push(id); },
});

process.env.CRON_SECRET = 'secreto-cron';
process.env.SIIGO_USERNAME = 'cliente@empresa.com';
const handler = require('../api/v1/siigo/import-invoices');

function run() {
  const res = {
    statusCode: null, body: null, setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
  return handler({ method: 'GET', headers: { authorization: 'Bearer secreto-cron' }, query: {}, body: {} }, res)
    .then(() => res);
}

test('una factura con producto nuevo queda como novedad y no frena el cursor', async () => {
  Object.assign(state, { recordResult: true, cursorWrites: [], recorded: [] });
  const res = await run();
  assert.equal(res.statusCode, 207);
  assert.deepEqual(state.recorded, [['inv-1', 'Productos no sincronizados: NUEVO-1']]);
  assert.equal(state.cursorWrites.length, 1, 'el cursor avanza porque la factura quedó registrada');
  assert.equal(res.body.data.results[0].tracked, true);
});

test('si la novedad no se pudo registrar, el cursor no avanza para no perder la factura', async () => {
  Object.assign(state, { recordResult: false, cursorWrites: [], recorded: [] });
  const res = await run();
  assert.equal(res.statusCode, 207);
  assert.equal(state.cursorWrites.length, 0);
  assert.equal(res.body.data.results[0].tracked, false);
});

test('el handler expone el reintento por factura para la pantalla de novedades', () => {
  assert.equal(typeof handler.retryInvoiceById, 'function');
});

test('los errores se clasifican en tipos legibles con los códigos faltantes', () => {
  delete require.cache[resolve('api/_lib/siigo.invoice-issues.js')];
  const { classifyImportError: classify } = require('../api/_lib/siigo.invoice-issues');
  assert.deepEqual(classify('Productos no sincronizados: A-1, B-2'), { tipo: 'PRODUCTO_NO_SINCRONIZADO', codigos: ['A-1', 'B-2'] });
  assert.equal(classify('Factura FV-1 usa multiples bodegas; requiere despachos separados').tipo, 'BODEGAS_MULTIPLES');
  assert.equal(classify('Bodega SIIGO 2 no esta mapeada a BG-PPAL en WMS').tipo, 'BODEGA_NO_MAPEADA');
  assert.equal(classify('algo inesperado').tipo, 'OTRO');
});
