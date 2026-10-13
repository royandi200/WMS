const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function load({ existing, customers }) {
  const calls = { inserts: 0, siigo: 0 };
  const dbPath = require.resolve(path.join(__dirname, '../api/_lib/db'));
  const siigoPath = require.resolve(path.join(__dirname, '../api/_lib/siigo.service'));
  const libPath = require.resolve(path.join(__dirname, '../api/_lib/siigo.terceros'));
  delete require.cache[libPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql) => {
      if (/INSERT INTO terceros/.test(sql)) { calls.inserts++; return []; }
      return /SELECT id FROM terceros/.test(sql) && existing ? [{ id: 1 }] : [];
    },
  } };
  require.cache[siigoPath] = { id: siigoPath, filename: siigoPath, loaded: true, exports: {
    siigoGet: async () => { calls.siigo++; return { results: customers }; },
  } };
  const lib = require(libPath);
  delete require.cache[dbPath];
  delete require.cache[siigoPath];
  delete require.cache[libPath];
  return { lib, calls };
}

const invoice = { customer: { id: 'abc', identification: '830129327' } };

test('a known customer is not requested from SIIGO', async () => {
  const { lib, calls } = load({ existing: true, customers: [] });
  assert.equal(await lib.ensureInvoiceCustomer(invoice), 'exists');
  assert.equal(calls.siigo, 0);
});

test('an unknown customer is brought from SIIGO and stored', async () => {
  const { lib, calls } = load({ existing: false, customers: [{ id: 'abc', identification: '830129327', name: ['Cliente', 'QA'] }] });
  assert.equal(await lib.ensureInvoiceCustomer(invoice), 'created');
  assert.equal(calls.inserts, 1);
});

test('a customer missing in SIIGO is reported, not invented', async () => {
  const { lib, calls } = load({ existing: false, customers: [] });
  assert.equal(await lib.ensureInvoiceCustomer(invoice), 'not_found');
  assert.equal(calls.inserts, 0);
});
