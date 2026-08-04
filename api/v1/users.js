const { createConnection } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES, capabilitiesForRole } = require('../_lib/capabilities');

const ASSIGNABLE_ROLES = new Set(['admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
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
    return res.status(200).json({
      ok: true,
      data: {
        users: users.map(user => ({ ...user, capabilities: capabilitiesForRole(user.rol) })),
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
  const roleName = String(req.body?.role || req.body?.rol || '').trim().toLowerCase();
  if (!Number.isInteger(userId) || userId <= 0) throw httpError(400, 'user_id es obligatorio');
  if (!ASSIGNABLE_ROLES.has(roleName)) throw httpError(400, 'Rol no permitido');
  if (userId === Number(actor.id) && roleName !== 'admin') {
    throw httpError(409, 'No puedes retirar tu propio rol de administrador');
  }
  const conn = await createConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.execute(
      `SELECT u.id, u.nombre, r.nombre AS rol_anterior
       FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.id = ? LIMIT 1 FOR UPDATE`,
      [userId]
    );
    if (!users.length) throw httpError(404, 'Usuario no encontrado');
    const [roles] = await conn.execute(`SELECT id, nombre FROM roles WHERE LOWER(nombre) = ? LIMIT 1`, [roleName]);
    if (!roles.length) throw httpError(409, 'El rol aun no existe en la base de datos');
    await conn.execute(`UPDATE usuarios SET rol_id = ? WHERE id = ?`, [roles[0].id, userId]);
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('autorizacion', 'INFO', 'Cambio de rol de usuario', ?, ?, NOW())`,
      [actor.id, JSON.stringify({
        usuario_id: userId,
        rol_anterior: users[0].rol_anterior,
        rol_nuevo: roles[0].nombre,
        canal: 'dashboard',
      })]
    );
    await conn.commit();
    return res.status(200).json({
      ok: true,
      data: { id: userId, nombre: users[0].nombre, rol: roles[0].nombre, capabilities: capabilitiesForRole(roles[0].nombre) },
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET,PUT');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'PUT') return await handlePut(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[users]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
