const { createConnection, query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');
const { normalizePurchaseOrderInput } = require('../_lib/purchase-orders');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function handleGet(req, res) {
  await requireCapability(req, CAPABILITIES.RECEPTION_READ);
  const limit = Math.min(Math.max(Number(req.query?.limit || 100), 1), 200);
  const estado = String(req.query?.estado || '').trim().toUpperCase();
  const where = estado ? 'WHERE oc.estado = ?' : '';
  const params = estado ? [estado, limit] : [limit];
  const rows = await query(
    `SELECT oc.id, oc.numero, oc.tercero_id, oc.proveedor_nombre, oc.fecha_orden,
            oc.estado, oc.archivo_nombre, oc.creado_en, oc.actualizado_en,
            u.nombre AS creado_por_nombre,
            COUNT(oci.id) AS total_items,
            COALESCE(SUM(oci.cantidad_ordenada), 0) AS total_unidades
     FROM ordenes_compra_proveedor oc
     JOIN usuarios u ON u.id = oc.creado_por
     LEFT JOIN orden_compra_proveedor_items oci ON oci.orden_compra_id = oc.id
     ${where}
     GROUP BY oc.id, oc.numero, oc.tercero_id, oc.proveedor_nombre, oc.fecha_orden,
              oc.estado, oc.archivo_nombre, oc.creado_en, oc.actualizado_en, u.nombre
     ORDER BY oc.creado_en DESC
     LIMIT ?`,
    params
  );
  return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
}

async function resolveProduct(conn, item) {
  const [rows] = await conn.execute(
    `SELECT id, siigo_code, nombre
     FROM productos
     WHERE (? IS NOT NULL AND id = ?) OR (? IS NOT NULL AND siigo_code = ?)
     LIMIT 1`,
    [item.productId, item.productId, item.sku, item.sku]
  );
  if (!rows.length) throw httpError(404, `Producto no encontrado: ${item.sku || item.productId}`);
  return rows[0];
}

async function handlePost(req, res) {
  const user = await requireCapability(req, CAPABILITIES.RECEPTION_CREATE);
  const input = normalizePurchaseOrderInput(req.body || {});
  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();
    const [existing] = await conn.execute(
      `SELECT id, numero, estado, archivo_hash
       FROM ordenes_compra_proveedor WHERE numero = ? LIMIT 1 FOR UPDATE`,
      [input.numero]
    );
    if (existing.length) {
      if (existing[0].archivo_hash === input.hash) {
        await conn.commit();
        return res.status(200).json({ ok: true, data: { ...existing[0], duplicate: true } });
      }
      throw httpError(409, `La orden ${input.numero} ya existe con contenido diferente`);
    }

    if (input.terceroId) {
      const [suppliers] = await conn.execute(`SELECT id FROM terceros WHERE id = ? LIMIT 1`, [input.terceroId]);
      if (!suppliers.length) throw httpError(404, 'Proveedor no encontrado');
    }

    const resolvedItems = [];
    for (const item of input.items) {
      resolvedItems.push({ ...item, product: await resolveProduct(conn, item) });
    }

    const [created] = await conn.execute(
      `INSERT INTO ordenes_compra_proveedor
         (numero, tercero_id, proveedor_nombre, fecha_orden, estado, archivo_nombre,
          archivo_hash, datos_origen, creado_por, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, 'CARGADA', ?, ?, ?, ?, NOW(), NOW())`,
      [input.numero, input.terceroId, input.proveedorNombre, input.fechaOrden,
       input.archivoNombre, input.hash,
       input.sourceData == null ? null : JSON.stringify(input.sourceData), user.id]
    );

    for (const item of resolvedItems) {
      await conn.execute(
        `INSERT INTO orden_compra_proveedor_items
           (orden_compra_id, producto_id, referencia_origen, descripcion_origen,
            cantidad_ordenada, unidad, precio_unitario, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [created.insertId, item.product.id, item.sku || item.product.siigo_code,
         item.description, item.quantity, item.unit, item.unitPrice]
      );
    }
    await conn.commit();
    return res.status(201).json({
      ok: true,
      data: {
        id: created.insertId,
        numero: input.numero,
        estado: 'CARGADA',
        items: resolvedItems.map(item => ({
          producto_id: item.product.id,
          sku: item.product.siigo_code,
          producto: item.product.nombre,
          cantidad_ordenada: item.quantity,
        })),
      },
    });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[purchase-orders]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
