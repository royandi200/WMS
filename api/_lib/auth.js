// api/_lib/auth.js — verifica JWT en Authorization: Bearer <token>
const jwt = require('jsonwebtoken');

function cors(res, methods = 'GET, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', methods + ', OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function verifyToken(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw Object.assign(new Error('Token requerido'), { status: 401 });
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw Object.assign(new Error('Token inválido o expirado'), { status: 401 });
  }
}

module.exports = { cors, verifyToken };
