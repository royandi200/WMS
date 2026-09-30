const fs = require('node:fs');
const path = require('node:path');
const { createConnection } = require('../../api/_lib/db');

function loadEnv() {
  const candidates = [path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) throw new Error('No se encontró configuración de base de datos');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
  for (const [dbKey, mysqlKey] of [
    ['DB_HOST', 'MYSQL_HOST'], ['DB_PORT', 'MYSQL_PORT'], ['DB_USER', 'MYSQL_USER'],
    ['DB_PASSWORD', 'MYSQL_PASSWORD'], ['DB_NAME', 'MYSQL_DATABASE'],
  ]) process.env[dbKey] ||= process.env[mysqlKey];
}

async function inspect(conn) {
  const [products] = await conn.execute(
    `SELECT id, siigo_code, nombre FROM productos
      WHERE siigo_code = '00017-ETASH60' AND activo = 1 LIMIT 2`
  );
  if (products.length !== 1) throw new Error('El SKU no identifica un único producto activo');
  const product = products[0];
  const [locations] = await conn.execute(
    `SELECT DISTINCT u.id, u.codigo, u.bodega_id
       FROM stock s
       JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
       JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
      WHERE s.producto_id = ? AND u.codigo = 'A1' AND s.cantidad > 0`,
    [product.id]
  );
  if (locations.length !== 1) throw new Error('A1 no corresponde a una única ubicación activa con stock real de este SKU');
  const location = locations[0];
  const [assignments] = await conn.execute(
    `SELECT pu.ubicacion_id, u.codigo, pu.prioridad, pu.tipo_asignacion, pu.activa
       FROM producto_ubicaciones pu
       JOIN ubicaciones u ON u.id = pu.ubicacion_id
      WHERE pu.producto_id = ? ORDER BY pu.prioridad, pu.id`, [product.id]
  );
  if (assignments.some(row => row.activa && row.tipo_asignacion === 'PRIMARIA'
    && Number(row.ubicacion_id) !== Number(location.id))) {
    throw new Error('El SKU ya tiene otra ubicación primaria activa; revisión manual requerida');
  }
  return { product, location, assignments };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--confirm-primary-location')) {
    throw new Error('Falta --confirm-primary-location');
  }
  loadEnv();
  const conn = await createConnection();
  try {
    const before = await inspect(conn);
    if (apply) {
      await conn.beginTransaction();
      try {
        await conn.execute(
          `INSERT INTO producto_ubicaciones
             (producto_id, ubicacion_id, prioridad, tipo_asignacion, activa, fuente)
           VALUES (?, ?, 1, 'PRIMARIA', 1, 'STOCK_FISICO_VERIFICADO')
           ON DUPLICATE KEY UPDATE prioridad = 1, tipo_asignacion = 'PRIMARIA',
             activa = 1, fuente = 'STOCK_FISICO_VERIFICADO', actualizado_en = NOW()`,
          [before.product.id, before.location.id]
        );
        await conn.commit();
      } catch (error) { await conn.rollback().catch(() => {}); throw error; }
    }
    const after = await inspect(conn);
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run',
      sku: before.product.siigo_code, location: before.location.codigo,
      before: before.assignments, after: after.assignments })}\n`);
  } finally { await conn.end(); }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
