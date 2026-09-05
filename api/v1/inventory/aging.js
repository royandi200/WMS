const { query } = require('../../_lib/db');
const { cors, requireAuth } = require('../../_lib/auth');
const { DEFAULT_DWELL_DAYS } = require('../../_lib/inventory-aging');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { await requireAuth(req); } catch (error) {
    return res.status(error.status || 401).json({ ok: false, error: error.message });
  }

  try {
    const rows = await query(
      `SELECT l.id AS lot_id, l.lpn, l.created_at AS fecha_ingreso,
              DATEDIFF(CURDATE(), DATE(l.created_at)) AS dias_permanencia,
              p.permanencia_max_dias AS dias_limite,
              DATEDIFF(CURDATE(), DATE(l.created_at)) - p.permanencia_max_dias AS dias_exceso,
              l.expiry_date AS fecha_vencimiento, l.status AS estado,
              p.id AS producto_id, p.siigo_code AS sku, p.nombre AS producto,
              COALESCE(NULLIF(p.unit_label, ''), 'und') AS unidad,
              b.codigo AS bodega,
              COALESCE(
                (SELECT GROUP_CONCAT(DISTINCT u.codigo ORDER BY u.codigo SEPARATOR ', ')
                   FROM stock s
                   JOIN ubicaciones u ON u.id = s.ubicacion_id
                  WHERE s.producto_id = l.product_id AND s.bodega_id = l.bodega_id
                    AND s.lote = l.lpn AND s.cantidad > 0),
                (SELECT GROUP_CONCAT(DISTINCT u.codigo ORDER BY u.codigo SEPARATOR ', ')
                   FROM recepcion_distribuciones rd
                   JOIN ubicaciones u ON u.id = rd.ubicacion_id
                  WHERE rd.lote = l.lpn AND rd.cantidad > 0),
                'Sin ubicacion'
              ) AS ubicacion,
              l.qty_current AS cantidad,
              COALESCE((SELECT SUM(s.reservada) FROM stock s
                         WHERE s.producto_id = l.product_id AND s.bodega_id = l.bodega_id
                           AND s.lote = l.lpn), 0) AS reservada,
              CASE WHEN l.status = 'DISPONIBLE'
                   THEN GREATEST(l.qty_current - COALESCE((SELECT SUM(s.reservada) FROM stock s
                                WHERE s.producto_id = l.product_id AND s.bodega_id = l.bodega_id
                                  AND s.lote = l.lpn), 0), 0)
                   ELSE 0 END AS disponible
         FROM lots l
         JOIN productos p ON p.id = l.product_id
         JOIN bodegas b ON b.id = l.bodega_id
        WHERE l.qty_current > 0
          AND l.status NOT IN ('DESPACHADO', 'AGOTADO')
          AND DATEDIFF(CURDATE(), DATE(l.created_at)) >= p.permanencia_max_dias
        ORDER BY dias_permanencia DESC, p.siigo_code, l.lpn
        LIMIT 500`,
      []
    );
    return res.status(200).json({
      ok: true,
      data: { default_days: DEFAULT_DWELL_DAYS, rows, total: rows.length },
    });
  } catch (error) {
    console.error('[inventory/aging]', error.message);
    return res.status(500).json({ ok: false, error: 'No fue posible consultar la permanencia del inventario' });
  }
};
