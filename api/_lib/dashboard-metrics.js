const { quantityTotals } = require('./quantity-totals');

function reportingPeriod(period = 'week', now = new Date()) {
  const days = { today: 1, week: 7, month: 30 }[period];
  if (!days) throw Object.assign(new Error('Periodo invalido'), { status: 400 });
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const end = new Date(`${date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { period, today: date, timezone: 'America/Bogota', from: `${start.toISOString().slice(0, 10)} 00:00:00`,
    to: `${end.toISOString().slice(0, 10)} 00:00:00` };
}

// All KPI queries aggregate the complete period in SQL. LIMIT is only used for
// the explicitly bounded recent-activity list, never to calculate totals.
async function dashboardMetrics(query, { period, now = new Date(), approvalsAllowed = false } = {}) {
  const range = reportingPeriod(period, now);
  const args = [range.from, range.to];
  const reception = await query(`/* dashboard:reception */
    SELECT COUNT(DISTINCT r.id) AS count
    FROM recepciones r WHERE r.completado_en >= ? AND r.completado_en < ?`, args);
  const received = await query(`/* dashboard:received */
    SELECT p.unit_label AS unidad, SUM(ri.cantidad_rec) AS cantidad
    FROM recepciones r JOIN recepcion_items ri ON ri.recepcion_id = r.id
    JOIN productos p ON p.id = ri.producto_id
    WHERE r.completado_en >= ? AND r.completado_en < ? GROUP BY p.unit_label`, args);
  const rejected = await query(`/* dashboard:rejected */
    SELECT p.unit_label AS unidad, SUM(rd.cantidad) AS cantidad
    FROM recepcion_distribuciones rd JOIN recepciones r ON r.id = rd.recepcion_id
    JOIN recepcion_items ri ON ri.id = rd.recepcion_item_id
    JOIN productos p ON p.id = ri.producto_id
    WHERE r.completado_en >= ? AND r.completado_en < ? AND rd.condicion = 'RECHAZADO'
    GROUP BY p.unit_label`, args);
  const production = await query(`/* dashboard:production */
    SELECT estado, COUNT(*) AS count,
      SUM(CASE WHEN cerrado_en >= ? AND cerrado_en < ? THEN 1 ELSE 0 END) AS closed
    FROM ordenes_produccion GROUP BY estado`, args);
  const waste = await query(`/* dashboard:waste */
    SELECT COUNT(*) AS count, COUNT(DISTINCT orden_produccion_id) AS orders
    FROM mermas WHERE creado_en >= ? AND creado_en < ?`, args);
  const wasteQuantities = await query(`/* dashboard:waste-quantities */
    SELECT p.unit_label AS unidad, SUM(m.cantidad) AS cantidad
    FROM mermas m JOIN productos p ON p.id = m.producto_id
    WHERE m.creado_en >= ? AND m.creado_en < ? GROUP BY p.unit_label`, args);
  const stock = await query(`/* dashboard:stock */
    SELECT p.unit_label AS unidad,
      COUNT(DISTINCT CASE WHEN s.cantidad > COALESCE(s.reservada, 0) THEN p.id END) AS products,
      SUM(GREATEST(s.cantidad - COALESCE(s.reservada, 0), 0)) AS cantidad,
      SUM(COALESCE(s.reservada, 0)) AS reserved
    FROM stock s JOIN productos p ON p.id = s.producto_id AND p.activo = 1
    JOIN lots l ON l.product_id = s.producto_id AND BINARY l.lpn = BINARY s.lote
    JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id AND u.activa = 1
    JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
    WHERE l.status = 'DISPONIBLE' AND (l.expiry_date IS NULL OR l.expiry_date >= ?)
    GROUP BY p.unit_label`, [range.today]);
  const flows = await query(`/* dashboard:flows */
    SELECT CASE WHEN k.qty > 0 THEN 'entry' ELSE 'exit' END AS direction,
      p.unit_label AS unidad, SUM(ABS(k.qty)) AS cantidad, COUNT(*) AS count
    FROM kardex k JOIN productos p ON p.id = k.product_id
    WHERE k.created_at >= ? AND k.created_at < ? AND k.qty <> 0
    GROUP BY direction, p.unit_label`, args);
  const recent = await query(`/* dashboard:recent */
    SELECT k.id, k.action, k.qty, k.created_at, k.reference,
      p.siigo_code AS sku, p.unit_label AS unit
    FROM kardex k JOIN productos p ON p.id = k.product_id
    WHERE k.created_at >= ? AND k.created_at < ?
    ORDER BY k.created_at DESC, k.id DESC LIMIT 8`, args);
  const approvals = approvalsAllowed ? await query(`/* dashboard:approvals */
    SELECT accion, COUNT(*) AS count, MIN(creado_en) AS oldest
    FROM aprobaciones WHERE estado = 'PENDIENTE' GROUP BY accion`) : null;
  const byStatus = Object.fromEntries(production.map(row => [row.estado, Number(row.count)]));
  return {
    range, generatedAt: now.toISOString(),
    reception: { count: Number(reception[0]?.count || 0), quantities: quantityTotals(received), rejected: quantityTotals(rejected) },
    production: { byStatus, closed: production.reduce((n, row) => n + Number(row.closed), 0) },
    waste: { count: Number(waste[0]?.count || 0), orders: Number(waste[0]?.orders || 0), quantities: quantityTotals(wasteQuantities) },
    stock: { products: stock.reduce((n, row) => n + Number(row.products), 0), quantities: quantityTotals(stock), reserved: quantityTotals(stock, 'reserved') },
    flows: Object.fromEntries(['entry', 'exit'].map(direction => {
      const rows = flows.filter(row => row.direction === direction);
      return [direction, { count: rows.reduce((n, row) => n + Number(row.count), 0), quantities: quantityTotals(rows) }];
    })),
    approvals: approvals && {
      count: approvals.reduce((n, row) => n + Number(row.count), 0),
      byType: Object.fromEntries(approvals.map(row => [row.accion, Number(row.count)])),
      oldest: approvals.map(row => row.oldest).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || null,
    },
    recent,
  };
}

module.exports = { reportingPeriod, dashboardMetrics };
