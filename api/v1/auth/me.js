// api/v1/auth/me.js
// GET /api/v1/auth/me  — devuelve el usuario del token
const jwt = require('jsonwebtoken');
const { query } = require('../../_lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ ok: false, error: 'No autorizado' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const rows = await query(
      `SELECT u.id, u.nombre, u.email, u.activo,
              r.nombre AS rol_nombre
       FROM usuarios u
       LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.id = ? AND u.activo = 1
       LIMIT 1`,
      [payload.id]
    );

    if (!rows.length)
      return res.status(401).json({ ok: false, error: 'Usuario no encontrado' });

    const user = rows[0];
    return res.json({
      ok: true,
      usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol_nombre },
    });
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
};
