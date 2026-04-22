// GET /api/v1/inventory/mapa
// Devuelve todas las ubicaciones de todas las bodegas activas
// con el stock actual por ubicación (JOIN con tabla stock)
const { query }                = require('../../_lib/db')
const { cors, verifyToken }    = require('../../_lib/auth')

module.exports = async (req, res) => {
  cors(res, 'GET')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET')     return res.status(405).json({ ok:false, error:'Method not allowed' })
  try { verifyToken(req) } catch(e) { return res.status(401).json({ ok:false, error:e.message }) }

  try {
    // Todas las ubicaciones activas con su bodega
    const ubicaciones = await query(`
      SELECT
        u.id,
        u.codigo,
        u.zona,
        u.pasillo,
        u.nivel,
        u.posicion,
        u.activa,
        b.id   AS bodega_id,
        b.codigo AS bodega_codigo,
        b.nombre AS bodega_nombre
      FROM ubicaciones u
      JOIN bodegas b ON b.id = u.bodega_id
      WHERE u.activa = 1 AND b.activa = 1
      ORDER BY b.codigo, u.zona, u.pasillo, u.nivel, u.posicion
    `)

    if (!ubicaciones.length) {
      return res.json({ ok:true, data:{ ubicaciones:[], bodegas:[] } })
    }

    // Stock por ubicación (agrupa todos los productos/lotes)
    const stockRows = await query(`
      SELECT
        s.ubicacion_id,
        SUM(s.cantidad)  AS cantidad_total,
        COUNT(DISTINCT s.producto_id) AS num_productos,
        GROUP_CONCAT(
          CONCAT(p.siigo_code,'|',p.nombre,'|',COALESCE(s.lote,'—'),'|',s.cantidad)
          ORDER BY s.cantidad DESC
          SEPARATOR ';;'
        ) AS detalle_raw,
        MIN(p.stock_minimo) AS min_stock_ref
      FROM stock s
      JOIN productos p ON p.id = s.producto_id
      WHERE s.ubicacion_id IS NOT NULL AND s.cantidad > 0
      GROUP BY s.ubicacion_id
    `)

    const stockMap = {}
    for (const row of stockRows) {
      const items = (row.detalle_raw || '').split(';;').map(d => {
        const [sku, nombre, lote, cantidad] = d.split('|')
        return { sku, nombre, lote, cantidad: parseFloat(cantidad)||0 }
      })
      stockMap[row.ubicacion_id] = {
        cantidad_total: parseFloat(row.cantidad_total)||0,
        num_productos:  parseInt(row.num_productos)||0,
        min_stock_ref:  parseFloat(row.min_stock_ref)||0,
        items,
      }
    }

    // Ensamblar respuesta
    const result = ubicaciones.map(u => {
      const stock  = stockMap[u.id]
      const estado = !stock
        ? 'vacio'
        : stock.cantidad_total <= stock.min_stock_ref
          ? 'bajo'
          : 'ok'
      return {
        id:             u.id,
        codigo:         u.codigo,
        zona:           u.zona   || 'Sin zona',
        pasillo:        u.pasillo|| '—',
        nivel:          u.nivel  || '—',
        posicion:       u.posicion|| '—',
        bodega_id:      u.bodega_id,
        bodega_codigo:  u.bodega_codigo,
        bodega_nombre:  u.bodega_nombre,
        estado,
        cantidad_total: stock?.cantidad_total || 0,
        num_productos:  stock?.num_productos  || 0,
        items:          stock?.items          || [],
      }
    })

    // Lista de bodegas únicas
    const bodegas = [...new Map(
      ubicaciones.map(u => [u.bodega_id, { id:u.bodega_id, codigo:u.bodega_codigo, nombre:u.bodega_nombre }])
    ).values()]

    return res.json({ ok:true, data:{ ubicaciones:result, bodegas } })
  } catch(err) {
    console.error('[inventory/mapa]', err.message)
    return res.status(500).json({ ok:false, error:err.message })
  }
}
