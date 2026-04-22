// GET /api/v1/inventory/mapa-migrate
// Agrega columnas canvas_x/canvas_y a ubicaciones si no existen
const { query } = require('../../_lib/db')
const { cors, verifyToken } = require('../../_lib/auth')

module.exports = async (req, res) => {
  cors(res, 'GET')
  if (req.method === 'OPTIONS') return res.status(200).end()
  try { verifyToken(req) } catch(e) { return res.status(401).json({ ok:false, error:e.message }) }

  const log = []
  try {
    for (const col of ['canvas_x','canvas_y']) {
      try {
        await query(`ALTER TABLE ubicaciones ADD COLUMN ${col} INT NOT NULL DEFAULT 0`)
        log.push(`✅ ${col} — creada`)
      } catch(e) {
        log.push(`ℹ️ ${col} — ya existe`)
      }
    }
    return res.json({ ok:true, log })
  } catch(err) {
    return res.status(500).json({ ok:false, error:err.message, log })
  }
}
