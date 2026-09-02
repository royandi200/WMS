const fs = require('fs');
const path = require('path');

const ASSIGNABLE_ROLES = new Set(['admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta']);

function loadEnv() {
  const candidates = [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../../.env')];
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

function normalizePhone(value) {
  return String(value || '').replace(/\D/gu, '').slice(-10);
}

async function main() {
  loadEnv();
  const phone = normalizePhone(argument('phone'));
  const actorPhone = normalizePhone(argument('actor-phone'));
  const role = argument('role').toLowerCase();
  if (phone.length !== 10 || actorPhone.length !== 10 || !role) {
    throw new Error('Usa --phone=... --role=... --actor-phone=...');
  }
  if (!ASSIGNABLE_ROLES.has(role)) throw new Error('Rol no permitido');
  const { createConnection } = require('../../api/_lib/db');
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [targets] = await conn.execute(
      `SELECT u.id, u.nombre, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) = ? AND u.activo = 1
        FOR UPDATE`,
      [phone]
    );
    const [actors] = await conn.execute(
      `SELECT u.id, u.nombre, u.email, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) = ? AND u.activo = 1`,
      [actorPhone]
    );
    if (targets.length !== 1) throw new Error('La linea objetivo no identifica un unico usuario activo');
    if (actors.length !== 1 || actors[0].rol !== 'admin') throw new Error('La linea actora no identifica un administrador activo');
    const target = targets[0];
    const actor = actors[0];
    if (target.id === actor.id && role !== 'admin') throw new Error('No puedes retirar tu propio rol de administrador');
    const [roles] = await conn.execute('SELECT id, nombre FROM roles WHERE LOWER(nombre) = ? LIMIT 1', [role]);
    if (roles.length !== 1) throw new Error('El rol no existe');
    await conn.execute('UPDATE usuarios SET rol_id = ? WHERE id = ?', [roles[0].id, target.id]);
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Cambio de rol de usuario', ?, ?, NOW())`,
      [actor.id, JSON.stringify({
        usuario_id: target.id,
        rol_anterior: target.rol,
        rol_nuevo: roles[0].nombre,
        canal: 'qa_demo',
      })]
    );
    const [rows] = await conn.execute(
      `SELECT u.id, u.nombre, u.telefono, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
      [target.id]
    );
    if (rows[0]?.rol !== role) throw new Error('El rol efectivo no coincide con el solicitado');
    await conn.commit();
    console.log(JSON.stringify({ ok: true, previousRole: target.rol, user: rows[0], changedBy: actor.nombre }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
