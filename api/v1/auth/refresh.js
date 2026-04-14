// api/v1/auth/refresh.js
// POST /api/v1/auth/refresh  { refresh_token }
const jwt = require('jsonwebtoken');
const { query } = require('../../_lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token)
      return res.status(400).json({ ok: false, error: 'refresh_token requerido' });

    const decoded = jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    const rows = await query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol_nombre
       FROM usuarios u
       LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.id = ? AND u.activo = 1 LIMIT 1`,
      [decoded.id]
    );

    if (!rows.length)
      return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });

    const user = rows[0];
    const access_token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol_nombre },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return res.json({ ok: true, access_token });
  } catch {
    return res.status(401).json({ ok: false, error: 'Refresh token inválido o expirado' });
  }
};
