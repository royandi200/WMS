const https = require('https');
const { createConnection } = require('./db');

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(digits)) return `57${digits}`;
  return /^573\d{9}$/.test(digits) ? digits : null;
}

function maskPhone(phone) {
  return `${String(phone).slice(0, 4)}******${String(phone).slice(-2)}`;
}

function notificationsEnabled() {
  const disabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.DISABLE_OUTBOUND_NOTIFICATIONS || '').trim().toLowerCase());
  return !disabled;
}

function recipientPhones(rows, excludeUserIds = []) {
  const excludedUsers = new Set(excludeUserIds.map(Number).filter(Number.isInteger));
  return [...new Set(rows
    .filter(row => !excludedUsers.has(Number(row.id)))
    .map(row => normalizePhone(row.telefono))
    .filter(Boolean))];
}

function sendMessage(phone, text) {
  const token = process.env.BUILDERBOT_API_TOKEN;
  const botId = process.env.BUILDERBOT_BOT_ID;
  if (!token || !botId) return Promise.reject(new Error('BuilderBot no configurado'));
  const body = JSON.stringify({ number: phone, messages: { content: text } });
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'app.builderbot.cloud',
      path: `/api/v2/${botId}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-builderbot': token,
      },
      timeout: 10000,
    }, response => {
      let raw = '';
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(raw);
        reject(new Error(`BuilderBot HTTP ${response.statusCode}`));
      });
    });
    request.on('timeout', () => request.destroy(new Error('BuilderBot timeout')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function notifyRoles({ event, roles, text, fallbackRoles = ['admin'], excludeUserIds = [] }) {
  if (!notificationsEnabled()) {
    return [{ status: 'disabled' }];
  }
  const conn = await createConnection();
  try {
    const normalizedRoles = [...new Set(roles.map(role => String(role).toLowerCase()))];
    const fallback = [...new Set(fallbackRoles.map(role => String(role).toLowerCase()))];
    const find = async roleNames => {
      if (!roleNames.length) return [];
      const placeholders = roleNames.map(() => '?').join(',');
      const [rows] = await conn.execute(
        `SELECT u.id, u.telefono FROM usuarios u JOIN roles r ON r.id = u.rol_id
         WHERE u.activo = 1 AND u.telefono IS NOT NULL AND u.email NOT LIKE '%@wa.bot'
           AND LOWER(r.nombre) IN (${placeholders}) ORDER BY u.id`,
        roleNames
      );
      return recipientPhones(rows, excludeUserIds);
    };
    let phones = await find(normalizedRoles);
    if (!phones.length) phones = await find(fallback);
    if (!phones.length) {
      await conn.execute(
        `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
         VALUES ('whatsapp', 'WARN', 'Notificacion sin destinatarios', ?, ?, NOW())`,
        [excludeUserIds[0] || null, JSON.stringify({ event, roles: normalizedRoles, fallback_roles: fallback })]
      ).catch(() => {});
      return [{ status: 'no_recipient' }];
    }
    const results = [];
    for (const phone of phones) {
      let notificationId;
      try {
        const [created] = await conn.execute(
          `INSERT INTO notificaciones_salida
             (evento, canal, destinatario, mensaje, estado, intentos, creado_en)
           VALUES (?, 'WHATSAPP', ?, ?, 'PENDIENTE', 0, NOW())`,
          [event, phone, text]
        );
        notificationId = created.insertId;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          const [existing] = await conn.execute(
            `SELECT id, estado FROM notificaciones_salida
             WHERE evento = ? AND canal = 'WHATSAPP' AND destinatario = ? LIMIT 1`,
            [event, phone]
          );
          if (!existing.length || existing[0].estado !== 'ERROR') {
            results.push({ recipient: maskPhone(phone), status: 'duplicate' });
            continue;
          }
          notificationId = existing[0].id;
        } else {
          throw error;
        }
      }
      try {
        await sendMessage(phone, text);
        await conn.execute(
          `UPDATE notificaciones_salida SET estado = 'ENVIADA', intentos = intentos + 1,
               enviado_en = NOW(), ultimo_error = NULL WHERE id = ?`,
          [notificationId]
        );
        results.push({ recipient: maskPhone(phone), status: 'sent' });
      } catch (error) {
        await conn.execute(
          `UPDATE notificaciones_salida SET estado = 'ERROR', intentos = intentos + 1,
               ultimo_error = ? WHERE id = ?`,
          [String(error.message).slice(0, 1000), notificationId]
        );
        results.push({ recipient: maskPhone(phone), status: 'error', error: error.message });
      }
    }
    return results;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function retryNotification(id) {
  if (!notificationsEnabled()) {
    throw Object.assign(new Error('Las notificaciones de flujo estan desactivadas'), { status: 409 });
  }
  const notificationId = Number(id || 0);
  if (!Number.isInteger(notificationId) || notificationId <= 0) throw Object.assign(new Error('notificacion_id es obligatorio'), { status: 400 });
  let phone;
  let message;
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT id, destinatario, mensaje, estado FROM notificaciones_salida WHERE id = ? LIMIT 1 FOR UPDATE`,
      [notificationId]
    );
    if (!rows.length) throw Object.assign(new Error('Notificacion no encontrada'), { status: 404 });
    if (rows[0].estado === 'ENVIADA') {
      await conn.commit();
      return { id: notificationId, status: 'already_sent' };
    }
    if (rows[0].estado === 'PENDIENTE') {
      await conn.commit();
      return { id: notificationId, status: 'already_pending' };
    }
    phone = normalizePhone(rows[0].destinatario);
    if (!phone) throw Object.assign(new Error('Destinatario invalido'), { status: 409 });
    message = rows[0].mensaje;
    await conn.execute(
      `UPDATE notificaciones_salida SET estado = 'PENDIENTE', ultimo_error = NULL WHERE id = ?`,
      [notificationId]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }

  try {
    await sendMessage(phone, message);
    const sentConn = await createConnection();
    try {
      await sentConn.execute(
        `UPDATE notificaciones_salida SET estado = 'ENVIADA', intentos = intentos + 1,
             enviado_en = NOW(), ultimo_error = NULL WHERE id = ? AND estado = 'PENDIENTE'`,
        [notificationId]
      );
    } finally {
      await sentConn.end().catch(() => {});
    }
    return { id: notificationId, recipient: maskPhone(phone), status: 'sent' };
  } catch (error) {
    const errorConn = await createConnection();
    try {
      await errorConn.execute(
        `UPDATE notificaciones_salida SET estado = 'ERROR', intentos = intentos + 1,
             ultimo_error = ? WHERE id = ?`,
        [String(error.message).slice(0, 1000), notificationId]
      );
    } finally {
      await errorConn.end().catch(() => {});
    }
    throw Object.assign(new Error(error.message), { status: 502 });
  }
}

module.exports = { notifyRoles, retryNotification, normalizePhone, maskPhone, notificationsEnabled, recipientPhones };
