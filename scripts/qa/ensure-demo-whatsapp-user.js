const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ASSIGNABLE_ROLES = new Set(['admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta']);
const APPLY_TOKEN = 'APPLY_DEMO_WHATSAPP_USER';

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
  const digits = String(value || '').replace(/\D/gu, '');
  if (/^3\d{9}$/u.test(digits)) return `57${digits}`;
  return /^573\d{9}$/u.test(digits) ? digits : '';
}

async function main() {
  loadEnv();
  const phone = normalizePhone(argument('phone'));
  const actorPhone = normalizePhone(argument('actor-phone'));
  const name = argument('name');
  const role = argument('role').toLowerCase();
  const apply = argument('confirmation') === APPLY_TOKEN;
  if (!phone || !actorPhone || !name || !role) {
    throw new Error('Usa --phone=... --name=... --role=... --actor-phone=...');
  }
  if (!ASSIGNABLE_ROLES.has(role)) throw new Error('Rol no permitido');

  const { createConnection } = require('../../api/_lib/db');
  const conn = await createConnection();
  try {
    const [actors] = await conn.execute(
      `SELECT u.id, u.nombre, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.telefono = ? AND u.activo = 1`,
      [actorPhone]
    );
    if (actors.length !== 1 || actors[0].rol !== 'admin') {
      throw new Error('La linea actora no identifica un administrador activo');
    }
    const [roles] = await conn.execute('SELECT id, nombre FROM roles WHERE LOWER(nombre) = ? LIMIT 1', [role]);
    if (roles.length !== 1) throw new Error('El rol no existe');
    const [existing] = await conn.execute(
      `SELECT u.id, u.nombre, u.telefono, u.activo, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.telefono = ?`,
      [phone]
    );
    if (existing.length > 1) throw new Error('La linea identifica mas de un usuario');

    const preview = {
      ok: true,
      dryRun: !apply,
      action: existing.length ? 'update' : 'create',
      current: existing[0] || null,
      desired: { name, phone, role },
    };
    if (!apply) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    await conn.beginTransaction();
    let userId;
    if (existing.length) {
      userId = existing[0].id;
      await conn.execute(
        'UPDATE usuarios SET nombre = ?, rol_id = ?, activo = 1 WHERE id = ?',
        [name, roles[0].id, userId]
      );
    } else {
      const email = `demo.whatsapp.${phone}@wms.local`;
      const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
      const [created] = await conn.execute(
        `INSERT INTO usuarios (nombre, email, telefono, password_hash, rol_id, activo, creado_en)
         VALUES (?, ?, ?, ?, ?, 1, NOW())`,
        [name, email, phone, passwordHash, roles[0].id]
      );
      userId = created.insertId;
    }
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Usuario WhatsApp de demo asegurado', ?, ?, NOW())`,
      [actors[0].id, JSON.stringify({
        usuario_id: userId,
        telefono: phone,
        rol_anterior: existing[0]?.rol || null,
        rol_nuevo: role,
        canal: 'qa_demo',
      })]
    );
    const [verified] = await conn.execute(
      `SELECT u.id, u.nombre, u.telefono, u.activo, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = ?`,
      [userId]
    );
    if (verified.length !== 1 || verified[0].rol !== role || Number(verified[0].activo) !== 1) {
      throw new Error('No fue posible verificar el usuario efectivo');
    }
    await conn.commit();
    console.log(JSON.stringify({ ...preview, dryRun: false, user: verified[0], changedBy: actors[0].nombre }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
