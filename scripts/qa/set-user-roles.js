const fs = require('fs');
const path = require('path');

const APPLY_TOKEN = 'APPLY_USER_ROLES';
const ASSIGNABLE_ROLES = new Set(['admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta']);

function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env'),
  ];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

function argument(name) {
  return String(process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '').trim();
}

async function main() {
  loadEnv();
  const userId = Number(argument('user-id') || 0);
  const roles = [...new Set(argument('roles').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
  const actorPhone = argument('actor-phone').replace(/\D/gu, '');
  const apply = argument('confirmation') === APPLY_TOKEN;
  if (!Number.isInteger(userId) || userId <= 0 || !roles.length || !/^573\d{9}$/u.test(actorPhone)) {
    throw new Error('Usa --user-id=... --roles=recepcion_cierre,despacho --actor-phone=57...');
  }
  if (roles.some(role => !ASSIGNABLE_ROLES.has(role))) throw new Error('Hay roles no permitidos');

  const { createConnection } = require('../../api/_lib/db');
  const { loadUserRolesFromConnection } = require('../../api/_lib/user-roles');
  const conn = await createConnection();
  try {
    const [users] = await conn.execute(
      `SELECT u.id, u.nombre, u.activo, u.rol_id, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.id = ? LIMIT 1`,
      [userId]
    );
    const [actors] = await conn.execute(
      `SELECT u.id, u.nombre, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.telefono = ? AND u.activo = 1 LIMIT 1`,
      [actorPhone]
    );
    if (users.length !== 1 || Number(users[0].activo) !== 1) throw new Error('Usuario objetivo no encontrado o inactivo');
    if (actors.length !== 1 || actors[0].rol !== 'admin') throw new Error('Actor administrador no valido');
    const before = await loadUserRolesFromConnection(conn, userId, users[0].rol);
    const placeholders = roles.map(() => '?').join(',');
    const [roleRows] = await conn.execute(
      `SELECT id, LOWER(nombre) AS nombre FROM roles WHERE LOWER(nombre) IN (${placeholders})`,
      roles
    );
    if (roleRows.length !== roles.length) throw new Error('Uno o mas roles no existen');
    const preview = { ok: true, dryRun: !apply, user: { id: userId, nombre: users[0].nombre }, before, after: roles };
    if (!apply) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    const byName = new Map(roleRows.map(role => [role.nombre, role]));
    const primaryName = roles.includes(users[0].rol) ? users[0].rol : roles[0];
    await conn.beginTransaction();
    await conn.execute('UPDATE usuarios SET rol_id = ? WHERE id = ?', [byName.get(primaryName).id, userId]);
    await conn.execute('DELETE FROM usuario_roles WHERE usuario_id = ?', [userId]);
    for (const roleName of roles) {
      await conn.execute(
        `INSERT INTO usuario_roles (usuario_id, rol_id, es_principal, creado_en)
         VALUES (?, ?, ?, NOW())`,
        [userId, byName.get(roleName).id, roleName === primaryName ? 1 : 0]
      );
    }
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Roles multiples de usuario actualizados', ?, ?, NOW())`,
      [actors[0].id, JSON.stringify({ usuario_id: userId, roles_anteriores: before, roles_nuevos: roles, canal: 'qa_roles' })]
    );
    await conn.commit();
    console.log(JSON.stringify({ ...preview, dryRun: false, primaryRole: primaryName, changedBy: actors[0].nombre }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error?.message || error?.code || String(error));
  process.exitCode = 1;
});
