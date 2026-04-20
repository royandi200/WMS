// GET /api/v1/inventory/lot/:lpn
const { query } = require('../../../_lib/db');
const { cors, verifyToken } = require('../../../_lib/auth');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try { verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  const { lpn } = req.query;
  try {
    const rows = await query(
      `SELECT i.*, p.sku, p.nombre as name, p.unidad as unit
       FROM inventario i
       JOIN productos p ON p.id = i.producto_id
       WHERE i.lpn = ? LIMIT 1`,
      [lpn]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Lote no encontrado' });
    const row = rows[0];
    // Calcular estado real en base a fecha de vencimiento
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const fv = row.expiry_date ? new Date(row.expiry_date) : null;
    row.estado_calculado = fv && fv < hoy
      ? 'VENCIDO'
      : (row.status || 'DISPONIBLE').toUpperCase();
    return res.status(200).json({ ok: true, data: row });
  } catch (err) {
    console.error('[inventory/lot/:lpn]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al obtener lote' });
  }
};
