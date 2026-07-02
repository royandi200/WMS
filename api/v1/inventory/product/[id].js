const { query } = require('../../../_lib/db');
const { cors, requireAuth } = require('../../../_lib/auth');

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
         s.ubicacion_id,
         u.codigo AS ubicacion_codigo,
         u.zona AS ubicacion_zona,
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

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const lotes = rows.map((row) => {
      const expiry = row.expiry_date || row.fecha_venc;
      const expiryDate = expiry ? new Date(expiry) : null;
      return {
        ...row,
        cantidad: Number(row.cantidad || 0),
        reservada: Number(row.reservada || 0),
        disponible: Number(row.disponible || 0),
        qty_initial: row.qty_initial == null ? null : Number(row.qty_initial),
        qty_current: row.qty_current == null ? null : Number(row.qty_current),
        estado_calculado: expiryDate && expiryDate < hoy
          ? 'VENCIDO'
          : (row.lot_status || 'DISPONIBLE').toUpperCase(),
      };
    });

    const totals = lotes.reduce((acc, row) => {
      acc.cantidad += row.cantidad;
      acc.reservada += row.reservada;
      acc.disponible += row.disponible;
      return acc;
    }, { cantidad: 0, reservada: 0, disponible: 0 });

    return res.status(200).json({
      ok: true,
      data: {
        product,
        totals,
        rows: lotes,
        total: lotes.length,
      },
    });
  } catch (err) {
    console.error('[inventory/product/:id]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener producto' });
  }
};
