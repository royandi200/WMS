// /api/v1/siigo/stock-comparison
//   GET  (usuario)       → ultima comparacion guardada
//   GET  (cron de Vercel) → ejecuta la comparacion diaria
//   POST (usuario)       → ejecuta la comparacion ahora
// Solo lee de SIIGO; nunca crea ni modifica documentos alla.
const crypto = require('crypto');
const { cors, requireRole } = require('../../_lib/auth');
const { runStockComparison, latestStockComparison } = require('../../_lib/siigo.stock-comparison');

function isCron(req) {
  const expected = process.env.CRON_SECRET;
  const auth = String(req.headers?.authorization || '');
  if (!expected || !auth.startsWith('Bearer ')) return false;
  const a = Buffer.from(auth.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  cors(res, 'GET, POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    if (req.method === 'GET' && isCron(req)) {
      const result = await runStockComparison({ origen: 'AUTOMATICA' });
      return res.status(200).json({ ok: true, data: result.resumen });
    }
    const user = await requireRole(req, ['Admin', 'Supervisor']);
    const data = req.method === 'POST'
      ? await runStockComparison({ origen: 'MANUAL', usuarioId: user.id })
      : await latestStockComparison();
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[siigo/stock-comparison]', err.response?.data || err.message);
    return res.status(502).json({ ok: false, error: 'No se pudo comparar con SIIGO', detalle: err.message });
  }
};
