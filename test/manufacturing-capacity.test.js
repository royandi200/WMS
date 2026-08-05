const test = require('node:test');
const assert = require('node:assert/strict');

const { formatCapacityCheck, getEligibleStock } = require('../api/_lib/manufacturing-capacity');

test('eligible stock excludes unavailable, expired and inactive-location lots', async () => {
  let sqlUsed = '';
  const conn = {
    execute: async (sql, params) => {
      sqlUsed = sql;
      assert.deepEqual(params, [51, 1]);
      return [[{ disponible: '461.2500' }]];
    },
  };

  assert.equal(await getEligibleStock(conn, 51, 1), 461.25);
  assert.match(sqlUsed, /l\.status = 'DISPONIBLE'/);
  assert.match(sqlUsed, /u\.activa = 1/);
  assert.match(sqlUsed, />= CURDATE\(\)/);
});

test('capacity shortage states the missing quantity explicitly', () => {
  assert.deepEqual(formatCapacityCheck('00007-TRG', 5, 4), {
    ok: false,
    line: '  ❌ 00007-TRG: necesita 5, disponible 4, faltan 1',
  });
  assert.equal(formatCapacityCheck('00004-TPALB', 5, 10).ok, true);
});
