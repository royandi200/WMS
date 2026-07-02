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

  const lpn = String(req.query?.lpn || '').trim();
  if (!lpn) return res.status(400).json({ ok: false, error: 'LPN requerido' });

  try {
    const rows = await query(
      `SELECT
         l.id AS lot_id,
         l.lpn,
         l.product_id,
         p.siigo_code AS sku,
         p.nombre AS name,
         p.unit_label AS unit,
         l.bodega_id,
         b.codigo AS bodega_codigo,
         b.nombre AS bodega_nombre,
         l.qty_initial,
         l.qty_current,
         l.supplier,
         l.origin,
         l.status,
         l.expiry_date,
         l.created_at,
         l.updated_at,
         s.id AS stock_id,
         s.ubicacion_id,
         u.codigo AS ubicacion_codigo,
         u.zona AS ubicacion_zona,
         s.cantidad AS stock_cantidad,
         COALESCE(s.reservada, 0) AS stock_reservada,
         (s.cantidad - COALESCE(s.reservada, 0)) AS stock_disponible
       FROM lots l
       JOIN productos p ON p.id = l.product_id
       LEFT JOIN bodegas b ON b.id = l.bodega_id
       LEFT JOIN stock s ON BINARY s.lote = BINARY l.lpn AND s.producto_id = l.product_id
       LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
       WHERE BINARY l.lpn = BINARY ?
       LIMIT 1`,
      [lpn]
    );

    if (!rows.length) return res.status(404).json({ ok: false, error: 'Lote no encontrado' });

    const row = rows[0];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const expiryDate = row.expiry_date ? new Date(row.expiry_date) : null;

    return res.status(200).json({
      ok: true,
      data: {
        ...row,
        qty_initial: Number(row.qty_initial || 0),
        qty_current: Number(row.qty_current || 0),
        stock_cantidad: row.stock_cantidad == null ? null : Number(row.stock_cantidad),
        stock_reservada: row.stock_reservada == null ? null : Number(row.stock_reservada),
        stock_disponible: row.stock_disponible == null ? null : Number(row.stock_disponible),
        estado_calculado: expiryDate && expiryDate < hoy
          ? 'VENCIDO'
          : (row.status || 'DISPONIBLE').toUpperCase(),
      },
    });
  } catch (err) {
    console.error('[inventory/lot/:lpn]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener lote' });
  }
};
