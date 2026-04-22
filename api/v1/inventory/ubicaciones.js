// POST   /api/v1/inventory/ubicaciones        → crear ubicación
// PUT    /api/v1/inventory/ubicaciones        → actualizar posición/zona (drag)
// DELETE /api/v1/inventory/ubicaciones?id=X  → eliminar (solo si sin stock)
const { query } = require('../../_lib/db')
const { cors, verifyToken } = require('../../_lib/auth')

module.exports = async (req, res) => {
  cors(res, 'GET, POST, PUT, DELETE')
  if (req.method === 'OPTIONS') return res.status(200).end()
  try { verifyToken(req) } catch(e) { return res.status(401).json({ ok:false, error:e.message }) }

  try {
    // ── POST: crear ──────────────────────────────────────────────
    if (req.method === 'POST') {
      const { bodega_id=1, codigo, zona, pasillo, nivel='1', posicion='a',
              canvas_x, canvas_y } = req.body || {}
      if (!codigo || !zona) return res.status(400).json({ ok:false, error:'codigo y zona requeridos' })

      const [exist] = await query(
        'SELECT id FROM ubicaciones WHERE bodega_id=? AND codigo=? LIMIT 1',
        [bodega_id, codigo]
      )
      if (exist) return res.status(409).json({ ok:false, error:'Ya existe una ubicación con ese código' })

      // Intentar con canvas_x/canvas_y, si no existen usar INSERT básico
      let result
      try {
        result = await query(
          `INSERT INTO ubicaciones (bodega_id, codigo, zona, pasillo, nivel, posicion, canvas_x, canvas_y, activa)
           VALUES (?,?,?,?,?,?,?,?,1)`,
          [bodega_id, codigo, zona, pasillo||null, nivel, posicion, canvas_x||0, canvas_y||0]
        )
      } catch(e) {
        if (e.message.includes('canvas_x') || e.message.includes('canvas_y')) {
          result = await query(
            `INSERT INTO ubicaciones (bodega_id, codigo, zona, pasillo, nivel, posicion, activa)
             VALUES (?,?,?,?,?,?,1)`,
            [bodega_id, codigo, zona, pasillo||null, nivel, posicion]
          )
        } else throw e
      }
      return res.status(201).json({ ok:true, id: result.insertId })
    }

    // ── PUT: mover / renombrar zona ──────────────────────────────
    if (req.method === 'PUT') {
      const { id, zona, canvas_x, canvas_y, codigo, pasillo, nivel, posicion } = req.body || {}
      if (!id) return res.status(400).json({ ok:false, error:'id requerido' })

      const fields = []
      const vals   = []
      if (zona      != null) { fields.push('zona=?');     vals.push(zona) }
      if (canvas_x  != null) { fields.push('canvas_x=?'); vals.push(canvas_x) }
      if (canvas_y  != null) { fields.push('canvas_y=?'); vals.push(canvas_y) }
      if (codigo    != null) { fields.push('codigo=?');   vals.push(codigo) }
      if (pasillo   != null) { fields.push('pasillo=?');  vals.push(pasillo) }
      if (nivel     != null) { fields.push('nivel=?');    vals.push(nivel) }
      if (posicion  != null) { fields.push('posicion=?'); vals.push(posicion) }

      if (!fields.length) return res.status(400).json({ ok:false, error:'Nada que actualizar' })
      vals.push(id)
      await query(`UPDATE ubicaciones SET ${fields.join(',')} WHERE id=?`, vals)
      return res.json({ ok:true })
    }

    // ── DELETE: eliminar ─────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = req.query?.id
      if (!id) return res.status(400).json({ ok:false, error:'id requerido' })

      const [stock] = await query(
        'SELECT SUM(cantidad) as total FROM stock WHERE ubicacion_id=?', [id]
      )
      if (Number(stock?.total) > 0)
        return res.status(409).json({ ok:false, error:'No se puede eliminar: tiene stock asignado' })

      await query('DELETE FROM ubicaciones WHERE id=?', [id])
      return res.json({ ok:true })
    }

    return res.status(405).json({ ok:false, error:'Method not allowed' })
  } catch(err) {
    console.error('[inventory/ubicaciones]', err.message)
    return res.status(500).json({ ok:false, error:err.message })
  }
}
