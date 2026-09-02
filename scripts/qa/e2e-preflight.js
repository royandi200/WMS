const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  if (!fs.existsSync(envPath)) throw new Error(`No existe el archivo de entorno: ${envPath}`);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] ||= value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith('57')) return digits;
  return null;
}

function argument(name) {
  return String(process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '').trim();
}

function maskPhone(value) {
  const phone = normalizePhone(value);
  return phone ? `${phone.slice(0, 4)}******${phone.slice(-2)}` : 'invalido';
}

function asNumber(value) {
  return Number(value || 0);
}

async function main() {
  loadEnv();
  const adminPhone = normalizePhone(argument('admin-phone') || process.env.E2E_ADMIN_PHONE);
  const rotatingPhone = normalizePhone(argument('rotating-phone') || process.env.E2E_ROTATING_PHONE);
  const agentPhone = normalizePhone(argument('agent-phone') || process.env.E2E_AGENT_PHONE);
  if (!adminPhone || !rotatingPhone || !agentPhone) {
    throw new Error('Define las lineas en el entorno o usa --admin-phone, --rotating-phone y --agent-phone');
  }
  if (new Set([adminPhone, rotatingPhone, agentPhone]).size !== 3) {
    throw new Error('Las lineas de administrador, rotativa y agente deben ser diferentes');
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 15000,
  });
  const checks = [];
  const add = (id, ok, detail, blocking = true) => checks.push({ id, ok: Boolean(ok), blocking, detail });

  try {
    const [users] = await conn.execute(
      `SELECT u.id, u.nombre, u.email, u.telefono, u.activo, LOWER(r.nombre) AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) IN (?, ?)
       ORDER BY u.id`,
      [adminPhone.slice(-10), rotatingPhone.slice(-10)]
    );
    const adminUsers = users.filter((row) => normalizePhone(row.telefono) === adminPhone && row.activo);
    const rotatingUsers = users.filter((row) => normalizePhone(row.telefono) === rotatingPhone && row.activo);
    add('test-admin-user', adminUsers.length === 1,
      `${adminUsers.length} usuario(s) activo(s) para ${maskPhone(adminPhone)}; rol ${adminUsers[0]?.rol || 'N/A'}`);
    add('test-rotating-user', rotatingUsers.length === 1,
      `${rotatingUsers.length} usuario(s) activo(s) para ${maskPhone(rotatingPhone)}; rol ${rotatingUsers[0]?.rol || 'N/A'}`);

    const [agentUsers] = await conn.execute(
      `SELECT u.id, LOWER(r.nombre) AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id
       WHERE u.activo = 1
         AND RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) = ?`,
      [agentPhone.slice(-10)]
    );
    add('agent-not-operator', agentUsers.length === 0,
      agentUsers.length ? 'La linea del agente esta asignada a un usuario operativo' : `Linea ${maskPhone(agentPhone)} reservada para el bot`);

    const [roles] = await conn.execute(
      `SELECT LOWER(nombre) AS rol FROM roles
       WHERE LOWER(nombre) IN ('admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta')`
    );
    const roleSet = new Set(roles.map((row) => row.rol));
    const requiredRoles = ['admin', 'recepcion_cierre', 'alistador', 'despacho', 'consulta'];
    add('workflow-roles', requiredRoles.every((role) => roleSet.has(role)),
      `Roles presentes: ${requiredRoles.filter((role) => roleSet.has(role)).join(', ')}`);

    const [locations] = await conn.execute(
      `SELECT u.codigo FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
       WHERE u.activa = 1 AND b.activa = 1
         AND u.codigo IN ('PPAL-A-1-01', 'PPAL-A-1-02', 'CUAR-C-1-01', 'DEVOL-D-1-01')`
    );
    const locationSet = new Set(locations.map((row) => row.codigo));
    add('qa-locations', ['PPAL-A-1-01', 'PPAL-A-1-02', 'CUAR-C-1-01', 'DEVOL-D-1-01']
      .every((code) => locationSet.has(code)), `Ubicaciones QA activas: ${[...locationSet].join(', ')}`);

    const [receivingLocations] = await conn.execute(
      `SELECT u.codigo, b.codigo AS bodega
       FROM ubicaciones u JOIN bodegas b ON b.id = u.bodega_id
       WHERE u.activa = 1 AND b.activa = 1
         AND u.codigo IN ('PPAL-A-1-01', 'CUAR-C-1-01')`
    );
    add('reception-locations-primary-warehouse', receivingLocations.length === 2
      && receivingLocations.every((row) => row.bodega === 'BG-PPAL'), receivingLocations);

    const [products] = await conn.execute(
      `SELECT p.id, p.siigo_code, p.activo,
              (SELECT COUNT(*) FROM bom b WHERE b.producto_final_id = p.id) AS bom_items
       FROM productos p WHERE p.siigo_code IN ('00102-PTASH60', '00051-MPASH', '00004-TPALB', '00007-TRG', '00017-ETASH60')`
    );
    const productMap = new Map(products.map((row) => [row.siigo_code, row]));
    add('qa-products', productMap.size === 5 && [...productMap.values()].every((row) => row.activo),
      `${productMap.size}/5 productos QA activos`);
    add('production-bom', asNumber(productMap.get('00102-PTASH60')?.bom_items) >= 4,
      `00102-PTASH60 tiene ${asNumber(productMap.get('00102-PTASH60')?.bom_items)} componentes BOM activos`);

    const [fefo] = await conn.execute(
      `SELECT s.lote, s.fecha_venc, s.cantidad - COALESCE(s.reservada, 0) AS disponible
       FROM stock s JOIN productos p ON p.id = s.producto_id
       LEFT JOIN lots l ON l.lpn = s.lote
       WHERE p.siigo_code = '00051-MPASH'
         AND s.cantidad > COALESCE(s.reservada, 0)
         AND (s.fecha_venc IS NULL OR s.fecha_venc >= CURDATE())
         AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
       ORDER BY s.fecha_venc IS NULL, s.fecha_venc, s.lote LIMIT 1`
    );
    add('fefo-material-stock', fefo.length === 1,
      fefo.length ? `Primer lote FEFO valido: ${fefo[0].lote}; disponible ${fefo[0].disponible}` : 'Sin MPASH valida para producir');

    const [dispatchStock] = await conn.execute(
      `SELECT s.lote, s.cantidad - COALESCE(s.reservada, 0) AS disponible
       FROM stock s JOIN productos p ON p.id = s.producto_id
       LEFT JOIN lots l ON l.lpn = s.lote
       WHERE p.siigo_code = '00102-PTASH60'
         AND s.cantidad > COALESCE(s.reservada, 0)
         AND (s.fecha_venc IS NULL OR s.fecha_venc >= CURDATE())
         AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
       ORDER BY s.fecha_venc IS NULL, s.fecha_venc, s.lote LIMIT 1`
    );
    add('dispatch-stock', dispatchStock.length === 1,
      dispatchStock.length ? `Lote PT disponible: ${dispatchStock[0].lote}; saldo ${dispatchStock[0].disponible}` : 'Sin PT disponible para despacho');

    const [activeProductionOrders] = await conn.execute(
      `SELECT op.id, op.codigo_orden, op.estado, op.cantidad_planeada,
              p.siigo_code, op.origen_tipo, op.creado_en,
              COALESCE(SUM(pm.cantidad_reservada), 0) AS material_reservado
         FROM ordenes_produccion op
         JOIN productos p ON p.id = op.producto_id
         LEFT JOIN produccion_materiales pm ON pm.orden_produccion_id = op.id
        WHERE op.estado IN ('PLANEADA', 'APROBADA', 'EN_PROCESO')
        GROUP BY op.id, op.codigo_orden, op.estado, op.cantidad_planeada,
                 p.siigo_code, op.origen_tipo, op.creado_en
        ORDER BY op.creado_en DESC`
    );
    add('production-orders-clean', activeProductionOrders.length === 0,
      activeProductionOrders.length ? activeProductionOrders : 'Sin ordenes de produccion abiertas');

    const [pendingApprovals] = await conn.execute(
      `SELECT codigo_solicitud, accion, creado_en
         FROM aprobaciones WHERE estado = 'PENDIENTE'
        ORDER BY creado_en DESC`
    );
    add('pending-approvals-clean', pendingApprovals.length === 0,
      pendingApprovals.length ? pendingApprovals : 'Sin aprobaciones pendientes');

    const [invariants] = await conn.execute(
      `SELECT SUM(cantidad < 0) AS stock_negativo,
              SUM(reservada < 0) AS reserva_negativa,
              SUM(reservada > cantidad) AS reserva_superior_stock
       FROM stock`
    );
    const invariant = invariants[0] || {};
    add('stock-invariants', !asNumber(invariant.stock_negativo)
      && !asNumber(invariant.reserva_negativa)
      && !asNumber(invariant.reserva_superior_stock), invariant);

    const [pendingNotifications] = await conn.execute(
      `SELECT COUNT(*) AS total FROM notificaciones_salida WHERE estado IN ('PENDIENTE', 'ERROR')`
    );
    add('notification-queue', asNumber(pendingNotifications[0]?.total) === 0,
      `${asNumber(pendingNotifications[0]?.total)} notificaciones pendientes o con error`, false);

    const blockers = checks.filter((check) => check.blocking && !check.ok);
    console.log(JSON.stringify({
      ok: blockers.length === 0,
      database: process.env.DB_NAME,
      lines: {
        admin: maskPhone(adminPhone),
        rotating: maskPhone(rotatingPhone),
        agent: maskPhone(agentPhone),
      },
      checks,
      blockers: blockers.map((check) => check.id),
    }, null, 2));
    if (blockers.length) process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(`E2E preflight: ${error.message}`);
  process.exitCode = 1;
});
