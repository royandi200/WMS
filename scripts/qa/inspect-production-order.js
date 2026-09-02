const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv() {
  const candidates = [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../../.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) throw new Error('No se encontro el archivo de entorno');
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function argument(name) {
  return String(process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '').trim();
}

async function main() {
  loadEnv();
  const reference = argument('order');
  if (!reference) throw new Error('Usa --order=67 o --order=OP-...');
  const numericId = /^\d+$/u.test(reference) ? Number(reference) : null;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    connectTimeout: 15000,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  try {
    const [orders] = await conn.execute(
      `SELECT op.id, op.codigo_orden, op.estado, op.fase, op.origen_tipo,
              op.referencia_cliente, op.cliente_final, op.cantidad_planeada,
              op.cantidad_real, op.materiales_conf_en, op.cerrado_en,
              p.siigo_code, p.nombre AS producto,
              creator.nombre AS creado_por, approver.nombre AS aprobado_por
         FROM ordenes_produccion op
         JOIN productos p ON p.id = op.producto_id
         LEFT JOIN usuarios creator ON creator.id = op.creado_por
         LEFT JOIN usuarios approver ON approver.id = op.aprobado_por
        WHERE ${numericId ? 'op.id = ?' : 'op.codigo_orden = ?'} LIMIT 2`,
      [numericId || reference]
    );
    if (orders.length !== 1) throw new Error('La referencia no identifica una unica orden');
    const order = orders[0];
    const [materials] = await conn.execute(
      `SELECT p.siigo_code, p.nombre, pm.unidad, pm.cantidad_teorica,
              pm.cantidad_reservada, pm.cantidad_alistada, pm.cantidad_consumida,
              pm.cantidad_devuelta, pm.cantidad_adicional,
              pml.lote, u.codigo AS ubicacion, pml.cantidad_reservada AS lote_reservado,
              pml.cantidad_alistada AS lote_alistado,
              pml.cantidad_consumida AS lote_consumido,
              s.cantidad AS stock, s.reservada AS stock_reservado
         FROM produccion_materiales pm
         JOIN productos p ON p.id = pm.producto_id
         LEFT JOIN produccion_material_lotes pml ON pml.produccion_material_id = pm.id
         LEFT JOIN ubicaciones u ON u.id = pml.ubicacion_id
         LEFT JOIN stock s ON s.id = pml.stock_id
        WHERE pm.orden_produccion_id = ?
        ORDER BY p.siigo_code, pml.id`,
      [order.id]
    );
    const [movements] = await conn.execute(
      `SELECT action, qty, reference, created_at
         FROM kardex WHERE reference LIKE ? ORDER BY created_at, id`,
      [`%${order.codigo_orden}%`]
    );
    const materialGroups = new Map();
    for (const item of materials) {
      if (!materialGroups.has(item.siigo_code)) {
        materialGroups.set(item.siigo_code, {
          expected: Number(item.cantidad_reservada),
          allocated: 0,
        });
      }
      materialGroups.get(item.siigo_code).allocated += Number(item.lote_reservado || 0);
    }
    console.log(JSON.stringify({
      ok: true,
      order,
      materials,
      kardex: movements,
      invariants: {
        has_materials: materials.length > 0,
        reserved_matches: [...materialGroups.values()]
          .every(item => Math.abs(item.expected - item.allocated) < 0.000001),
        stock_covers_reservation: materials.every(item => Number(item.stock) >= Number(item.stock_reservado)),
      },
    }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(`Production order inspection: ${error.message}`);
  process.exitCode = 1;
});
