// api/v1/auth/login.js
// POST /api/v1/auth/login  { email, password }
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query } = require('../../_lib/db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ ok: false, error: 'Email y password requeridos' });

    // Buscar usuario activo con su rol
    const rows = await query(
      `SELECT u.id, u.nombre, u.email, u.password_hash, u.activo,
              r.id AS rol_id, r.nombre AS rol_nombre
       FROM usuarios u
       LEFT JOIN roles r ON r.id = u.rol_id
       WHERE u.email = ? AND u.activo = 1
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (!rows.length)
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });

    const payload = { id: user.id, email: user.email, rol: user.rol_nombre };

    const access_token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    const refresh_token = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      ok: true,
      access_token,
      refresh_token,
      usuario: {
        id:     user.id,
        nombre: user.nombre,
        email:  user.email,
        rol:    user.rol_nombre,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
