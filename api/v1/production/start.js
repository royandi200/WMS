// POST /api/v1/production/start
// Body: { product_id, qty_planned, notas? }
const { query } = require('../../_lib/db');
const { cors, verifyToken } = require('../../_lib/auth');

function generateOrderCode() {
  const now = new Date();
  const ymd = now.toISOString().slice(0,10).replace(/-/g,'');
  const rand = String(Math.floor(Math.random() * 9999)).padStart(4,'0');
  return `OP-${ymd}-${rand}`;
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  let user;
  try { user = verifyToken(req); } catch (e) { return res.status(401).json({ ok: false, error: e.message }); }

  try {
    const { product_id, qty_planned, notas } = req.body || {};
    if (!product_id || !qty_planned)
      return res.status(400).json({ ok: false, error: 'product_id y qty_planned son requeridos' });

    // Verificar producto
    const productos = await query(`SELECT id, siigo_code, nombre FROM productos WHERE id = ? LIMIT 1`, [product_id]);
    if (!productos.length) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });

    // Verificar BOM
    const bom = await query(`SELECT b.*, p.siigo_code AS sku FROM bom b LEFT JOIN productos p ON p.id = b.insumo_id WHERE b.producto_final_id = ?`, [product_id]);
    if (!bom.length) return res.status(422).json({ ok: false, error: `No existe BOM para ${productos[0].siigo_code}` });

    // Verificar stock de insumos
    const faltantes = [];
    for (const item of bom) {
      const necesario = parseFloat(item.cantidad_por_unidad) * Number(qty_planned);
      const stockRows = await query(`SELECT COALESCE(SUM(qty_current),0) AS total FROM lots WHERE product_id=? AND status='DISPONIBLE'`, [item.insumo_id]);
      const disponible = parseFloat(stockRows[0].total);
      if (disponible < necesario) faltantes.push(`${item.sku}: necesita ${necesario}, disponible ${disponible}`);
    }
    if (faltantes.length) return res.status(409).json({ ok: false, error: 'Stock insuficiente', faltantes });

    const codigo_orden = generateOrderCode();
    const result = await query(
      `INSERT INTO ordenes_produccion (codigo_orden, producto_id, cantidad_planeada, fase, estado, creado_por, notas, creado_en)
       VALUES (?, ?, ?, 'F0', 'PLANEADA', ?, ?, NOW())`,
      [codigo_orden, product_id, qty_planned, user.id, notas || null]
    );

    const rows = await query(
      `SELECT op.*, p.siigo_code AS sku, p.nombre AS product_name
       FROM ordenes_produccion op
       LEFT JOIN productos p ON p.id = op.producto_id
       WHERE op.id = ? LIMIT 1`, [result.insertId]
    );
    return res.status(201).json({
      ok: true,
      data: {
        order: { ...rows[0], order_code: codigo_orden },
        bom_required: bom.map(b => ({ sku: b.sku, needed: b.cantidad_por_unidad * qty_planned, unit: b.unidad }))
      }
    });
  } catch (err) {
    console.error('[production/start]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al iniciar producción' });
  }
};
