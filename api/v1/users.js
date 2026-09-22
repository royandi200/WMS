const { createConnection } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES, capabilitiesForRole, normalizeRoles } = require('../_lib/capabilities');
const { loadUserRolesFromConnection } = require('../_lib/user-roles');
const { maskPhone, normalizePhone } = require('../_lib/builderbot-notifications');

const ASSIGNABLE_ROLES = new Set(['admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeUserPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) throw httpError(400, 'Ingresa un celular colombiano valido de 10 digitos');
  return phone;
}

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.USERS_MANAGE);
  const conn = await createConnection();
  try {
    const [users] = await conn.execute(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.activo,
              r.nombre AS rol, u.creado_en
       FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.email NOT LIKE '%@wa.bot'
       ORDER BY u.activo DESC, u.nombre ASC`
    );
    const [roles] = await conn.execute(
      `SELECT id, nombre, descripcion FROM roles
       WHERE LOWER(nombre) IN ('admin','recepcion_cierre','alistador','despacho','consulta')
       ORDER BY FIELD(LOWER(nombre),'admin','recepcion_cierre','alistador','despacho','consulta')`
    );
    const hydratedUsers = [];
    for (const user of users) {
      const assignedRoles = await loadUserRolesFromConnection(conn, user.id, user.rol);
      hydratedUsers.push({
        ...user,
        roles: assignedRoles,
        capabilities: capabilitiesForRole(assignedRoles),
      });
    }
    return res.status(200).json({
      ok: true,
      data: {
        users: hydratedUsers,
        roles,
      },
    });
  } finally {
    await conn.end().catch(() => {});
  }
}

async function handlePut(req, res) {
  const actor = await requireCapability(req, CAPABILITIES.USERS_MANAGE);
  const userId = Number(req.body?.user_id || req.body?.id || 0);
  const requestedRoles = normalizeRoles(
    Array.isArray(req.body?.roles) ? req.body.roles : (req.body?.role || req.body?.rol)
  );
  if (!Number.isInteger(userId) || userId <= 0) throw httpError(400, 'user_id es obligatorio');
  if (!requestedRoles.length || requestedRoles.some(role => !ASSIGNABLE_ROLES.has(role))) {
    throw httpError(400, 'Roles no permitidos');
  }
  if (userId === Number(actor.id) && !requestedRoles.includes('admin')) {
    throw httpError(409, 'No puedes retirar tu propio rol de administrador');
  }
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.execute(
      `SELECT u.id, u.nombre, u.rol_id, r.nombre AS rol_anterior
       FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.id = ? LIMIT 1 FOR UPDATE`,
      [userId]
    );
    if (!users.length) throw httpError(404, 'Usuario no encontrado');
    const previousRoles = await loadUserRolesFromConnection(conn, userId, users[0].rol_anterior);
    const placeholders = requestedRoles.map(() => '?').join(',');
    const [roleRows] = await conn.execute(
      `SELECT id, LOWER(nombre) AS nombre FROM roles WHERE LOWER(nombre) IN (${placeholders})`,
      requestedRoles
    );
    if (roleRows.length !== requestedRoles.length) throw httpError(409, 'Uno o mas roles aun no existen en la base de datos');
    const roleByName = new Map(roleRows.map(role => [role.nombre, role]));
    const currentPrimary = String(users[0].rol_anterior || '').toLowerCase();
    const primaryName = requestedRoles.includes(currentPrimary) ? currentPrimary : requestedRoles[0];
    const primary = roleByName.get(primaryName);
    await conn.execute(`UPDATE usuarios SET rol_id = ? WHERE id = ?`, [primary.id, userId]);
    await conn.execute(`DELETE FROM usuario_roles WHERE usuario_id = ?`, [userId]);
    for (const roleName of requestedRoles) {
      const role = roleByName.get(roleName);
      await conn.execute(
        `INSERT INTO usuario_roles (usuario_id, rol_id, es_principal, creado_en)
         VALUES (?, ?, ?, NOW())`,
        [userId, role.id, roleName === primaryName ? 1 : 0]
      );
    }
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Cambio de rol de usuario', ?, ?, NOW())`,
      [actor.id, JSON.stringify({
        usuario_id: userId,
        roles_anteriores: previousRoles,
        roles_nuevos: requestedRoles,
        rol_principal: primaryName,
        canal: 'dashboard',
      })]
    );
    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: {
        id: userId,
        nombre: users[0].nombre,
        rol: primaryName,
        roles: requestedRoles,
        capabilities: capabilitiesForRole(requestedRoles),
      },
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

async function handlePatch(req, res) {
  const actor = await requireCapability(req, CAPABILITIES.USERS_MANAGE);
  const userId = Number(req.body?.user_id || req.body?.id || 0);
  if (!Number.isInteger(userId) || userId <= 0) throw httpError(400, 'user_id es obligatorio');
  const phone = normalizeUserPhone(req.body?.telefono ?? req.body?.phone);
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    // Always lock in the same order so concurrent dashboard edits cannot
    // assign the same WhatsApp destination or deadlock each other.
    const [allUsers] = await conn.execute(
      `SELECT id, nombre, telefono FROM usuarios ORDER BY id FOR UPDATE`
    );
    const users = allUsers.filter(user => Number(user.id) === userId);
    if (!users.length) throw httpError(404, 'Usuario no encontrado');
    const otherUsers = allUsers.filter(user => Number(user.id) !== userId);
    if (otherUsers.some(user => normalizePhone(user.telefono) === phone)) {
      throw httpError(409, 'Este celular ya esta asignado a otro usuario');
    }

    await conn.execute(`UPDATE usuarios SET telefono = ? WHERE id = ?`, [phone, userId]);
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Cambio de celular de usuario', ?, ?, NOW())`,
      [actor.id, JSON.stringify({
        usuario_id: userId,
        telefono_anterior: users[0].telefono ? maskPhone(normalizePhone(users[0].telefono) || users[0].telefono) : null,
        telefono_nuevo: maskPhone(phone),
        canal: 'dashboard',
      })]
    );
    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: { id: userId, nombre: users[0].nombre, telefono: phone },
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET,PUT,PATCH');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'PUT') return await handlePut(req, res);
    if (req.method === 'PATCH') return await handlePatch(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[users]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};

module.exports.normalizeUserPhone = normalizeUserPhone;
