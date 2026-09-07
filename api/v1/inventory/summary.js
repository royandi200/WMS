// GET /api/v1/inventory/summary
const { query } = require('../../_lib/db');
const { cors, requireAuth } = require('../../_lib/auth');
const { DEFAULT_DWELL_DAYS } = require('../../_lib/inventory-aging');
const { STOCK_JOINS_SQL, AVAILABLE_STOCK_SQL } = require('../../_lib/inventory-availability');
const { quantityTotals } = require('../../_lib/quantity-totals');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { await requireAuth(req); } catch (e) { return res.status(e.status || 401).json({ ok: false, error: e.message }); }

  try {
    const totalsRows = await query(
      `SELECT
         COUNT(DISTINCT s.producto_id)              AS total_productos,
         SUM(s.cantidad)                            AS total_unidades,
         COUNT(DISTINCT CASE WHEN p.activo=1 THEN p.id END) AS productos_activos,
         SUM(s.cantidad - s.reservada)              AS disponible,
         SUM(s.reservada)                           AS reservado
       FROM stock s
       LEFT JOIN productos p ON p.id = s.producto_id`
    );
    const totals = totalsRows[0];
    const stockRows = await query(`SELECT s.cantidad, COALESCE(s.reservada, 0) AS reservada,
      ${AVAILABLE_STOCK_SQL} AS disponible, NULLIF(p.unit_label, '') AS unidad
      FROM stock s JOIN productos p ON p.id = s.producto_id ${STOCK_JOINS_SQL}`);
    const quantities = quantityTotals(stockRows);
    const available = quantityTotals(stockRows, 'disponible');
    const reserved = quantityTotals(stockRows, 'reservada');

    const bajoRows = await query(
      `SELECT COUNT(*) AS cnt
       FROM (
         SELECT p.id
         FROM productos p
         LEFT JOIN stock s ON s.producto_id = p.id
         LEFT JOIN lots l ON l.product_id = s.producto_id AND BINARY l.lpn = BINARY s.lote
         LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id
         LEFT JOIN bodegas b ON b.id = s.bodega_id
         WHERE p.activo = 1 AND p.control_stock = 1 AND p.stock_minimo > 0
         GROUP BY p.id, p.stock_minimo
         HAVING COALESCE(SUM(CASE
           WHEN l.status = 'DISPONIBLE'
            AND (l.expiry_date IS NULL OR l.expiry_date >= CURDATE())
            AND u.id IS NOT NULL AND u.activa = 1 AND b.activa = 1
           THEN GREATEST(s.cantidad - COALESCE(s.reservada, 0), 0)
           ELSE 0 END), 0) <= p.stock_minimo
       ) sub`
    );
    const bajo_stock = bajoRows[0]?.cnt ?? 0;

    const alertasRows = await query(`SELECT COUNT(*) AS cnt FROM v_alertas_stock`);
    const vencRows    = await query(`SELECT COUNT(*) AS cnt FROM v_vencimientos_proximos`);
    const dwellRows = await query(
      `SELECT COUNT(DISTINCT l.id) AS cnt
        FROM lots l
        JOIN productos p ON p.id = l.product_id
        WHERE l.status NOT IN ('DESPACHADO', 'AGOTADO')
          AND l.qty_current > 0
          AND DATEDIFF(CURDATE(), DATE(l.created_at)) >= p.permanencia_max_dias
          `,
      []
    );

    return res.status(200).json({
      ok: true,
      data: {
        total_productos:      Number(totals.total_productos)   || 0,
        total_unidades:       quantities.length <= 1 ? (quantities[0]?.quantity || 0) : null,
        cantidades_por_unidad: quantities,
        disponible_por_unidad: available,
        reservado_por_unidad: reserved,
        productos_activos:    Number(totals.productos_activos) || 0,
        disponible:           available.length <= 1 ? (available[0]?.quantity || 0) : null,
        reservado:            reserved.length <= 1 ? (reserved[0]?.quantity || 0) : null,
        bajo_stock:           Number(bajo_stock),
        alertas_stock:        Number(alertasRows[0]?.cnt)      || 0,
        vencimientos_proximos:Number(vencRows[0]?.cnt)         || 0,
        permanencia_alertas:  Number(dwellRows[0]?.cnt)        || 0,
        permanencia_dias:     DEFAULT_DWELL_DAYS,
      }
    });
  } catch (err) {
    console.error('[inventory/summary]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
