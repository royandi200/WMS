const fs = require('fs');
const path = require('path');

const SEND_TOKEN = 'SEND_ALIAS_PROBE';
const PREPARE_TOKEN = 'PREPARE_ALIAS_PROBE';

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

function maskRecipient(value) {
  const recipient = String(value || '');
  return recipient.length <= 6
    ? `${recipient.slice(0, 1)}***${recipient.slice(-1)}`
    : `${recipient.slice(0, 4)}${'*'.repeat(Math.min(10, recipient.length - 6))}${recipient.slice(-2)}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), ...options });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { throw new Error(`${response.status} JSON invalido en ${new URL(url).pathname}`); }
  if (!response.ok || data?.ok === false) {
    throw new Error(`${response.status} ${data?.error || data?.message || 'Error API'} en ${new URL(url).pathname}`);
  }
  return data;
}

async function main() {
  loadEnv();
  const userId = Number(argument('user-id') || 0);
  const run = argument('run');
  const send = argument('confirmation') === SEND_TOKEN;
  const prepare = argument('confirmation') === PREPARE_TOKEN;
  if (!Number.isInteger(userId) || userId <= 0 || !/^[A-Za-z0-9_-]{3,40}$/u.test(run)) {
    throw new Error('Usa --user-id=... --run=identificador_seguro');
  }

  const base = String(process.env.WMS_PUBLIC_URL || 'https://wms-seven-ebon.vercel.app').replace(/\/$/u, '');
  if (prepare) {
    const { createConnection } = require('../../api/_lib/db');
    const conn = await createConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT uwa.alias, u.nombre,
                GROUP_CONCAT(DISTINCT LOWER(r.nombre) ORDER BY r.nombre SEPARATOR ',') AS roles
           FROM usuarios u
           JOIN usuario_roles ur ON ur.usuario_id = u.id
           JOIN roles r ON r.id = ur.rol_id
           JOIN usuario_whatsapp_aliases uwa
             ON uwa.usuario_id = u.id AND uwa.habilitado_salida = 1
          WHERE u.id = ? AND u.activo = 1
          GROUP BY uwa.alias, u.nombre
          ORDER BY uwa.alias ASC LIMIT 1`,
        [userId]
      );
      if (!rows.length) throw new Error('El usuario no tiene roles y alias saliente habilitado');
      const roles = String(rows[0].roles || '').split(',').filter(Boolean);
      if (!roles.includes('recepcion_cierre') || !roles.includes('despacho')) {
        throw new Error(`La base no refleja ambos roles (roles=${roles.join(',') || 'ninguno'})`);
      }
      const event = `QA_FACTURA_SIIGO_ALIAS:${run}`;
      const message = `🧪 Prueba WMS — factura de venta ficticia SIIGO ${run} asignada a despacho. No requiere accion.`;
      const [created] = await conn.execute(
        `INSERT INTO notificaciones_salida
           (evento, canal, destinatario, mensaje, estado, intentos, creado_en)
         VALUES (?, 'WHATSAPP', ?, ?, 'ERROR', 0, NOW())
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [event, rows[0].alias, message]
      );
      console.log(JSON.stringify({
        ok: true,
        prepared: true,
        user: { id: userId, nombre: rows[0].nombre, roles },
        event,
        notificationId: Number(created.insertId || 0),
        recipient: maskRecipient(rows[0].alias),
      }, null, 2));
      return;
    } finally {
      await conn.end();
    }
  }

  const email = process.env.E2E_DASHBOARD_EMAIL;
  const password = process.env.E2E_DASHBOARD_PASSWORD;
  if (!email || !password) throw new Error('Faltan credenciales E2E del dashboard');

  const login = await requestJson(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const token = login.access_token || login.data?.access_token || login.data?.token || login.token;
  if (!token) throw new Error('Login exitoso sin token');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const usersResponse = await requestJson(`${base}/api/v1/users?limit=100`, { headers });
  const users = usersResponse.data?.users || [];
  const user = users.find(candidate => Number(candidate.id) === userId);
  if (!user) throw new Error('La API desplegada no encontro el usuario objetivo');
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (!roles.includes('recepcion_cierre') || !roles.includes('despacho')) {
    throw new Error(`La API desplegada aun no refleja ambos roles (roles=${roles.join(',') || 'ninguno'})`);
  }

  const { createConnection } = require('../../api/_lib/db');
  const conn = await createConnection();
  try {
    const [aliases] = await conn.execute(
      `SELECT uwa.alias, uwa.habilitado_salida, u.nombre, u.telefono
         FROM usuario_whatsapp_aliases uwa
         JOIN usuarios u ON u.id = uwa.usuario_id
        WHERE uwa.usuario_id = ? AND uwa.habilitado_salida = 1
        ORDER BY uwa.id ASC LIMIT 1`,
      [userId]
    );
    if (!aliases.length) throw new Error('El usuario no tiene alias saliente habilitado');
    const target = aliases[0];
    const preview = {
      ok: true,
      dryRun: !send,
      base,
      user: { id: userId, nombre: target.nombre, roles },
      recipient: maskRecipient(target.alias),
      forcedAlias: true,
      phoneWasNotModified: true,
    };
    if (!send) {
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    const event = `QA_FACTURA_SIIGO_ALIAS:${run}`;
    const message = `🧪 Prueba WMS — factura de venta ficticia SIIGO ${run} asignada a despacho. No requiere accion.`;
    const [created] = await conn.execute(
      `INSERT INTO notificaciones_salida
         (evento, canal, destinatario, mensaje, estado, intentos, creado_en)
       VALUES (?, 'WHATSAPP', ?, ?, 'ERROR', 0, NOW())
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [event, target.alias, message]
    );
    const notificationId = Number(created.insertId || 0);
    if (!notificationId) throw new Error('No fue posible identificar la notificacion de prueba');
    const retry = await requestJson(`${base}/api/v1/notifications`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ notificacion_id: notificationId }),
    });
    console.log(JSON.stringify({ ...preview, dryRun: false, event, notificationId, apiResult: retry.data }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error?.message || error?.code || String(error));
  process.exitCode = 1;
});
