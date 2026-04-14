/**
 * Servicio de integración con la API de SIIGO
 * Docs: https://developers.siigo.com/docs
 */
const axios  = require('axios');
const logger = require('../utils/logger');

const BASE_URL = process.env.SIIGO_BASE_URL || 'https://api.siigo.com';
let _token    = null;
let _tokenExp = 0;

/**
 * Obtiene (o refresca) el token de acceso SIIGO.
 */
async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;

  const resp = await axios.post(`${BASE_URL}/auth`, {
    username:   process.env.SIIGO_USERNAME,
    access_key: process.env.SIIGO_ACCESS_KEY,
  }, {
    headers: { 'Partner-Id': process.env.SIIGO_PARTNER_ID },
  });

  _token    = resp.data.access_token;
  _tokenExp = Date.now() + (resp.data.expires_in - 60) * 1000;
  return _token;
}

/**
 * Cliente HTTP preconfigurado para SIIGO.
 */
async function siigoClient() {
  const token = await getToken();
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Partner-Id':    process.env.SIIGO_PARTNER_ID,
    },
  });
}

// ── Productos ───────────────────────────────────────────
async function getProductos({ page = 1, pageSize = 25 } = {}) {
  const client = await siigoClient();
  const resp   = await client.get('/v1/products', { params: { page, page_size: pageSize } });
  return resp.data;
}

// ── Órdenes de compra ────────────────────────────────────
async function getOrdenesCompra({ estado = 'active' } = {}) {
  const client = await siigoClient();
  const resp   = await client.get('/v1/purchase-orders', { params: { status: estado } });
  return resp.data;
}

// ── Órdenes de venta ─────────────────────────────────────
async function getOrdenesVenta({ estado = 'active' } = {}) {
  const client = await siigoClient();
  const resp   = await client.get('/v1/invoices', { params: { status: estado } });
  return resp.data;
}

// ── Registrar movimiento de inventario ───────────────────
async function registrarMovimiento(payload) {
  const client = await siigoClient();
  try {
    const resp = await client.post('/v1/inventory-adjustments', payload);
    return { ok: true, data: resp.data };
  } catch (err) {
    logger.error('SIIGO registrarMovimiento error', err?.response?.data);
    return { ok: false, error: err?.response?.data };
  }
}

module.exports = { getProductos, getOrdenesCompra, getOrdenesVenta, registrarMovimiento };
