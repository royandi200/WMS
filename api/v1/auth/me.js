const { cors, requireAuth } = require('../../_lib/auth');
const { capabilitiesForRole } = require('../../_lib/capabilities');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const user = await requireAuth(req);
    return res.json({
      ok: true,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        capabilities: capabilitiesForRole(user.rol),
      },
    });
  } catch (err) {
    return res.status(err.status || 401).json({ ok: false, error: err.message });
  }
};
