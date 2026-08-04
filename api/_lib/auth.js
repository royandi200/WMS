const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('./db');
const { capabilitiesForRole, hasCapability } = require('./capabilities');

function getAllowedOrigin() {
  const configured = process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:3000';
  return configured.split(',').map((origin) => origin.trim()).filter(Boolean)[0] || 'http://localhost:3000';
}

function cors(res, methods = 'GET, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', getAllowedOrigin());
  res.setHeader('Access-Control-Allow-Methods', methods + ', OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function verifyToken(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw Object.assign(new Error('Token requerido'), { status: 401 });
  if (!process.env.JWT_SECRET) throw Object.assign(new Error('JWT no configurado'), { status: 500 });
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw Object.assign(new Error('Token inválido o expirado'), { status: 401 });
  }
}

async function requireAuth(req) {
  const payload = verifyToken(req);
  const rows = await query(
    `SELECT u.id, u.nombre, u.email, u.activo, r.nombre AS rol
     FROM usuarios u
     LEFT JOIN roles r ON r.id = u.rol_id
     WHERE u.id = ? AND u.activo = 1
     LIMIT 1`,
    [payload.id]
  );
  if (!rows.length) throw Object.assign(new Error('Usuario no autorizado'), { status: 401 });
  const user = rows[0];
  if (!user.rol) throw Object.assign(new Error('Usuario sin rol asignado'), { status: 403 });
  return user;
}

async function requireRole(req, allowedRoles = []) {
  const user = await requireAuth(req);
  if (!allowedRoles.length) return user;
  const normalizedRole = String(user.rol || '').toLowerCase();
  const allowed = allowedRoles.map((role) => String(role).toLowerCase());
  if (!allowed.includes(normalizedRole)) {
    throw Object.assign(new Error('No tienes permiso para esta acción'), { status: 403 });
  }
  return user;
}

async function requireCapability(req, capability) {
  const user = await requireAuth(req);
  if (!hasCapability(user.rol, capability)) {
    throw Object.assign(new Error('No tienes permiso para esta accion'), { status: 403 });
  }
  return { ...user, capabilities: capabilitiesForRole(user.rol) };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireWebhookSecret(req) {
  const expected = process.env.BUILDERBOT_WEBHOOK_SECRET;
  if (!expected) {
    throw Object.assign(new Error('Webhook no configurado'), { status: 500 });
  }

  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const received =
    req.headers['x-builderbot-secret'] ||
    req.headers['x-webhook-secret'] ||
    bearer;

  if (!received || !safeEqual(received, expected)) {
    throw Object.assign(new Error('Webhook no autorizado'), { status: 401 });
  }
}

module.exports = {
  cors,
  verifyToken,
  requireAuth,
  requireRole,
  requireCapability,
  requireWebhookSecret,
};
