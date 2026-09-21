const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { inspect, migrate } = require('../scripts/apply-notification-utf8mb4-migration');

function fakeConnection(initialCollation = 'utf8mb3_general_ci') {
  let collation = initialCollation;
  const queries = [];
  return {
    queries,
    async execute(sql) {
      if (/information_schema\.TABLES/.test(sql)) return [[{ TABLE_COLLATION: collation }]];
      if (/information_schema\.COLUMNS/.test(sql)) {
        return [[
          { COLUMN_NAME: 'evento', DATA_TYPE: 'varchar', COLLATION_NAME: collation },
          { COLUMN_NAME: 'mensaje', DATA_TYPE: 'text', COLLATION_NAME: collation },
          { COLUMN_NAME: 'intentos', DATA_TYPE: 'int', COLLATION_NAME: null },
        ]];
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
    async query(sql) {
      queries.push(sql);
      assert.match(sql, /ALTER TABLE notificaciones_salida[\s\S]*utf8mb4_unicode_ci/u);
      collation = 'utf8mb4_unicode_ci';
      return [{ affectedRows: 0 }];
    },
  };
}

test('detecta la cola utf8mb3 como pendiente', async () => {
  const result = await inspect(fakeConnection());
  assert.equal(result.exists, true);
  assert.equal(result.valid, false);
  assert.deepEqual(result.incompatible_columns.map(column => column.name), ['evento', 'mensaje']);
});

test('el modo dry-run no modifica el esquema', async () => {
  const conn = fakeConnection();
  const result = await migrate(conn, false);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.pending, true);
  assert.equal(conn.queries.length, 0);
});

test('la migracion convierte tabla y columnas de texto a utf8mb4', async () => {
  const conn = fakeConnection();
  const result = await migrate(conn, true);
  assert.equal(result.mode, 'applied');
  assert.equal(result.pending, false);
  assert.equal(result.after.valid, true);
  assert.equal(conn.queries.length, 1);
});

test('las instalaciones nuevas crean la cola directamente en utf8mb4', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../database/09_notifications.sql'), 'utf8');
  assert.match(source, /DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci/u);
});
