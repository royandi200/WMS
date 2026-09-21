const fs = require('fs');
const path = require('path');

const APPLY_TOKEN = 'APPLY_USER_WHATSAPP_ALIAS';

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

async function main() {
  loadEnv();
  const phone = argument('phone').replace(/\D/gu, '');
  const alias = argument('alias');
  const actorPhone = argument('actor-phone').replace(/\D/gu, '');
  const apply = argument('confirmation') === APPLY_TOKEN;
  if (!/^573\d{9}$/u.test(phone) || !alias || !/^573\d{9}$/u.test(actorPhone)) {
    throw new Error('Usa --phone=57... --alias=... --actor-phone=57...');
  }

  const { createConnection } = require('../../api/_lib/db');
  const conn = await createConnection();
  try {
    const [users] = await conn.execute(
      `SELECT u.id, u.nombre, u.telefono, u.activo, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.telefono = ? LIMIT 1`,
      [phone]
    );
    const [actors] = await conn.execute(
      `SELECT u.id, u.nombre, LOWER(r.nombre) AS rol
         FROM usuarios u JOIN roles r ON r.id = u.rol_id
        WHERE u.telefono = ? AND u.activo = 1 LIMIT 1`,
      [actorPhone]
    );
    if (users.length !== 1 || Number(users[0].activo) !== 1) throw new Error('Usuario objetivo no encontrado o inactivo');
    if (actors.length !== 1 || actors[0].rol !== 'admin') throw new Error('Actor administrador no valido');
    const [existing] = await conn.execute(
      `SELECT uwa.id, uwa.alias, uwa.usuario_id, u.nombre
         FROM usuario_whatsapp_aliases uwa JOIN usuarios u ON u.id = uwa.usuario_id
        WHERE uwa.alias = ? LIMIT 1`,
      [alias]
    );
    if (existing.length && Number(existing[0].usuario_id) !== Number(users[0].id)) {
      throw new Error(`El alias ya pertenece a ${existing[0].nombre}`);
    }
    const preview = { ok: true, dryRun: !apply, user: users[0], alias, existing: existing[0] || null };
    if (!apply) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO usuario_whatsapp_aliases (usuario_id, alias, creado_en)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id)`,
      [users[0].id, alias]
    );
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Alias de identidad WhatsApp registrado', ?, ?, NOW())`,
      [actors[0].id, JSON.stringify({ usuario_id: users[0].id, telefono: phone, alias })]
    );
    await conn.commit();
    console.log(JSON.stringify({ ...preview, dryRun: false, changedBy: actors[0].nombre }, null, 2));
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
