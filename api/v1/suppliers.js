const { query } = require('../_lib/db');
const { cors, requireCapability } = require('../_lib/auth');
const { CAPABILITIES } = require('../_lib/capabilities');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    await requireCapability(req, CAPABILITIES.RECEPTION_READ);
    const rows = await query(
      `SELECT id, identification,
              COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre,
              siigo_id
         FROM terceros
        WHERE tipo = 'Supplier' AND activo = 1
          AND siigo_id IS NOT NULL AND siigo_id <> ''
        ORDER BY COALESCE(NULLIF(nombre_comercial, ''), nombre), id
        LIMIT 500`
    );
    return res.status(200).json({ ok: true, data: { rows, total: rows.length } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[suppliers]', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
