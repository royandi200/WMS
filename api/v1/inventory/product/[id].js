const { query } = require('../../../_lib/db');
const { cors, requireAuth } = require('../../../_lib/auth');
const { classifyInventoryRow } = require('../../../_lib/inventory-availability');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    await requireAuth(req);
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }

  const term = String(req.query?.id || '').trim();
  if (!term) return res.status(400).json({ ok: false, error: 'Producto requerido' });

  try {
    const productRows = await query(
      `SELECT id, siigo_code AS sku, nombre AS name, unit_label AS unit, stock_minimo AS min_stock
       FROM productos
       WHERE id = ? OR siigo_code = ?
       LIMIT 1`,
      [Number.isFinite(Number(term)) ? Number(term) : 0, term]
    );

    if (!productRows.length) {
      return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    }

    const product = productRows[0];
    const rows = await query(
      `SELECT
         s.id AS stock_id,
         s.producto_id,
         s.bodega_id,
         b.codigo AS bodega_codigo,
         b.nombre AS bodega_nombre,
         b.activa AS bodega_activa,
         s.ubicacion_id,
         u.codigo AS ubicacion_codigo,
         u.zona AS ubicacion_zona,
         u.activa AS ubicacion_activa,
         s.lote,
         s.fecha_venc,
         s.cantidad,
         COALESCE(s.reservada, 0) AS reservada,
         (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
         l.id AS lot_id,
         l.lpn,
         l.status AS lot_status,
         l.origin AS lot_origin,
         l.expiry_date,
         l.qty_initial,
         l.qty_current,
         s.actualizado_en
       FROM stock s
       LEFT JOIN bodegas b ON b.id = s.bodega_id
       LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
       LEFT JOIN lots l ON BINARY l.lpn = BINARY s.lote
       WHERE s.producto_id = ?
       ORDER BY
         CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
         COALESCE(l.expiry_date, s.fecha_venc) ASC,
         s.actualizado_en DESC,
         s.lote ASC`,
      [product.id]
    );

    const lotes = rows.map((row) => classifyInventoryRow(row));

    const movementRows = await query(
      `SELECT k.id, k.action, k.qty, k.balance_after, k.reference, k.created_at,
              l.lpn AS lote
         FROM kardex k
         LEFT JOIN lots l ON l.id = k.lot_id
        WHERE k.product_id = ?
        ORDER BY k.created_at DESC, k.id DESC
        LIMIT 20`,
      [product.id]
    );
    const movements = movementRows.map((movement) => ({
      ...movement,
      qty: Number(movement.qty || 0),
      balance_after: movement.balance_after == null ? null : Number(movement.balance_after),
    }));

    const totals = lotes.reduce((acc, row) => {
      acc.cantidad += row.cantidad;
      acc.reservada += row.reservada;
      acc.disponible += row.disponible;
      acc.bloqueada += row.bloqueada;
      return acc;
    }, { cantidad: 0, reservada: 0, disponible: 0, bloqueada: 0 });

    return res.status(200).json({
      ok: true,
      data: {
        product,
        totals,
        rows: lotes,
        total: lotes.length,
        movements,
      },
    });
  } catch (err) {
    console.error('[inventory/product/:id]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener producto' });
  }
};
