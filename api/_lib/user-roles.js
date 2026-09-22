const { normalizeRoles } = require('./capabilities');

function missingRoleTable(error) {
  return error?.code === 'ER_NO_SUCH_TABLE'
    || /usuario_roles.*doesn.t exist|no existe.*usuario_roles/iu.test(String(error?.message || ''));
}

async function loadUserRoles(runQuery, userId, primaryRole) {
  let assigned = [];
  try {
    assigned = await runQuery(
      `SELECT LOWER(r.nombre) AS rol
         FROM usuario_roles ur
         JOIN roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = ?
        ORDER BY ur.es_principal DESC, ur.creado_en ASC, r.id ASC`,
      [userId]
    );
  } catch (error) {
    if (!missingRoleTable(error)) throw error;
  }
  const rows = Array.isArray(assigned) ? assigned : [];
  return normalizeRoles([primaryRole, ...rows.map(row => row.rol)]);
}

async function loadUserRolesFromConnection(conn, userId, primaryRole) {
  return loadUserRoles(async (sql, params) => {
    const [rows] = await conn.execute(sql, params);
    return rows;
  }, userId, primaryRole);
}

module.exports = {
  loadUserRoles,
  loadUserRolesFromConnection,
  missingRoleTable,
};
