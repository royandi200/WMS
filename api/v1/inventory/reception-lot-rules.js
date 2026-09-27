const { createConnection } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');
const { normalizeProductId } = require('../../_lib/product-alert-settings');
const { normalizeRule } = require('../../_lib/reception-auto-lot');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = async (req, res) => {
  cors(res, 'GET, PUT');
  if (req.method === 'OPTIONS') return res.status(200).end();
  let conn;
  try {
    const actor = await requireRole(req, ['Admin']);
    if (!['GET', 'PUT'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });
    conn = await createConnection();
    if (req.method === 'GET') {
      const [suppliers] = await conn.execute(
        `SELECT id, COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre, identification
           FROM terceros WHERE tipo = 'Supplier' AND activo = 1 ORDER BY nombre, id`
      );
      const [rules] = await conn.execute(
        `SELECT r.producto_id, r.tercero_id, r.sigla, r.dias_retroceso, r.activa,
                p.siigo_code AS sku, t.nombre AS proveedor
           FROM recepcion_lote_reglas r
           JOIN productos p ON p.id = r.producto_id
           JOIN terceros t ON t.id = r.tercero_id
          ORDER BY p.siigo_code, t.nombre`
      );
      return res.status(200).json({ ok: true, data: { suppliers, rules } });
    }
    const productId = normalizeProductId(req.body?.producto_id);
    const supplierId = normalizeProductId(req.body?.tercero_id);
    const rule = normalizeRule(req.body);
    await conn.beginTransaction();
    const [product] = await conn.execute('SELECT id, siigo_code FROM productos WHERE id = ? AND activo = 1 LIMIT 1', [productId]);
    const [supplier] = await conn.execute("SELECT id, nombre FROM terceros WHERE id = ? AND tipo = 'Supplier' AND activo = 1 LIMIT 1", [supplierId]);
    const [before] = await conn.execute('SELECT sigla, dias_retroceso, activa FROM recepcion_lote_reglas WHERE producto_id = ? AND tercero_id = ? FOR UPDATE', [productId, supplierId]);
    if (!product.length) throw httpError(404, 'SKU activo no encontrado');
    if (!supplier.length) throw httpError(404, 'Proveedor activo no encontrado');
    await conn.execute(
      `INSERT INTO recepcion_lote_reglas
         (producto_id, tercero_id, sigla, dias_retroceso, activa, creado_por, actualizado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sigla = VALUES(sigla), dias_retroceso = VALUES(dias_retroceso),
         activa = VALUES(activa), actualizado_por = VALUES(actualizado_por), actualizado_en = NOW()`,
      [productId, supplierId, rule.sigla, rule.dias_retroceso, rule.activa ? 1 : 0, actor.id, actor.id]
    );
    await conn.execute(
      `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
       VALUES ('inventario', 'INFO', 'Cambio de regla de lote de recepción', ?, ?, NOW())`,
      [actor.id, JSON.stringify({ producto_id: productId, tercero_id: supplierId,
        anterior: before[0] || null, nuevo: rule, canal: 'dashboard' })]
    );
    await conn.commit();
    return res.status(200).json({ ok: true, data: { producto_id: productId,
      tercero_id: supplierId, sku: product[0].siigo_code, ...rule } });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[inventory/reception-lot-rules]', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible administrar las reglas de lote' });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
};
