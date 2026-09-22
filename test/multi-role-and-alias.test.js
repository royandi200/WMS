const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadUserRoles } = require('../api/_lib/user-roles');

test('user role loader preserves the primary role and adds unique secondary roles', async () => {
  const roles = await loadUserRoles(
    async () => [{ rol: 'recepcion_cierre' }, { rol: 'despacho' }, { rol: 'despacho' }],
    21,
    'recepcion_cierre'
  );
  assert.deepEqual(roles, ['recepcion_cierre', 'despacho']);
});

test('user role loader remains compatible before the migration is applied', async () => {
  const roles = await loadUserRoles(async () => {
    throw Object.assign(new Error("Table 'wms.usuario_roles' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
  }, 21, 'recepcion_cierre');
  assert.deepEqual(roles, ['recepcion_cierre']);
});

test('migration seeds current roles and enables aliases as outbound destinations', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../database/36_user_multi_roles_and_outbound_aliases.sql'),
    'utf8'
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS usuario_roles/u);
  assert.match(migration, /INSERT IGNORE INTO usuario_roles/u);
  assert.match(migration, /habilitado_salida TINYINT\(1\) NOT NULL DEFAULT 1/u);
  assert.doesNotMatch(migration, /DROP INDEX|DROP KEY/iu);
});

test('user management persists all selected roles transactionally', () => {
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/users.js'), 'utf8');
  assert.match(route, /Array\.isArray\(req\.body\?\.roles\)/u);
  assert.match(route, /DELETE FROM usuario_roles WHERE usuario_id = \?/u);
  assert.match(route, /INSERT INTO usuario_roles/u);
  assert.match(route, /roles_anteriores/u);
  assert.match(route, /roles_nuevos/u);
});
