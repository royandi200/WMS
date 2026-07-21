// api/_lib/siigo.service.js
// Fase 1 — Autenticación y cliente HTTP para SIIGO API
//
// Responsabilidades:
//  - Login contra POST /auth y cache del Bearer token en tabla `siigo_config`
//    (columnas clave: 'access_token', 'token_expiry')
//  - Refresco automático del token antes de que expire (SIIGO expira en 24h)
//  - Wrappers genéricos siigoGet()/siigoPost()/siigoPut() con logging
//    automático en `siigo_sync_log` para trazabilidad

const axios = require('axios');
const { query } = require('./db');

const SIIGO_BASE_URL  = process.env.SIIGO_BASE_URL  || 'https://api.siigo.com';
const SIIGO_USERNAME  = process.env.SIIGO_USERNAME;
const SIIGO_ACCESS_KEY = process.env.SIIGO_ACCESS_KEY;
const SIIGO_PARTNER_ID = process.env.SIIGO_PARTNER_ID || 'wms-integration';

// Margen de seguridad antes de expiración real (5 minutos)
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RATE_LIMIT_DELAY_MS = 3000;
const MAX_RATE_LIMIT_DELAY_MS = 10000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getRateLimitDelayMs(err) {
  const retryAfter = err.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(0, seconds * 1000));
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(MAX_RATE_LIMIT_DELAY_MS, Math.max(0, retryAt - Date.now()));
    }
  }

  const errors = err.response?.data?.Errors || err.response?.data?.errors || [];
  const message = errors.map(item => item?.Message || item?.message || '').join(' ');
  const match = message.match(/try again in\s+(\d+(?:\.\d+)?)\s+seconds?/i);
  if (match) {
    return Math.min(MAX_RATE_LIMIT_DELAY_MS, Number(match[1]) * 1000);
  }

  return DEFAULT_RATE_LIMIT_DELAY_MS;
}

function assertCredentials() {
  if (!SIIGO_USERNAME || !SIIGO_ACCESS_KEY) {
    const err = new Error('Credenciales SIIGO no configuradas (SIIGO_USERNAME / SIIGO_ACCESS_KEY)');
    err.status = 500;
    throw err;
  }
}

async function getConfigValue(clave) {
  const rows = await query(`SELECT valor FROM siigo_config WHERE clave = ? LIMIT 1`, [clave]);
  return rows[0]?.valor ?? null;
}

async function setConfigValue(clave, valor) {
  await query(
    `INSERT INTO siigo_config (clave, valor)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), actualizado_en = NOW()`,
    [clave, valor]
  );
}

/**
 * Login contra SIIGO POST /auth.
 * Guarda access_token y token_expiry en siigo_config.
 * SIIGO devuelve { access_token, token_type, expires_in } (expires_in en segundos).
 */
async function loginSiigo() {
  assertCredentials();
  const startedAt = Date.now();
  let statusCode = null;
  let errorMsg   = null;

  try {
    const resp = await axios.post(
      `${SIIGO_BASE_URL}/auth`,
      { username: SIIGO_USERNAME, access_key: SIIGO_ACCESS_KEY },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    statusCode = resp.status;

    const token        = resp.data?.access_token;
    const expiresInSec = Number(resp.data?.expires_in || 86400);
    if (!token) throw new Error('Respuesta de SIIGO sin access_token');

    const expiryDate = new Date(Date.now() + expiresInSec * 1000);
    await setConfigValue('access_token', token);
    await setConfigValue('token_expiry',  expiryDate.toISOString());
    await setConfigValue('partner_id',    SIIGO_PARTNER_ID);

    return { token, expiry: expiryDate };
  } catch (err) {
    statusCode = err.response?.status ?? null;
    errorMsg   = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw err;
  } finally {
    await logSync({
      entidad:      'auth',
      operacion:    'CREATE',
      endpoint:     '/auth',
      metodo_http:  'POST',
      request_body: { username: SIIGO_USERNAME, access_key: '***redacted***' },
      status_code:  statusCode,
      error_msg:    errorMsg,
      duracion_ms:  Date.now() - startedAt,
    }).catch(() => {});
  }
}

/**
 * Devuelve un token válido: usa el cacheado en siigo_config si no ha
 * expirado (con margen de seguridad), o hace login de nuevo.
 */
async function getValidToken() {
  const cachedToken  = await getConfigValue('access_token');
  const cachedExpiry = await getConfigValue('token_expiry');

  if (cachedToken && cachedExpiry) {
    const expiryMs = new Date(cachedExpiry).getTime();
    if (Number.isFinite(expiryMs) && expiryMs - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
      return cachedToken;
    }
  }

  const { token } = await loginSiigo();
  return token;
}

function defaultHeaders(token) {
  return {
    Authorization:  `Bearer ${token}`,
    'Partner-Id':   SIIGO_PARTNER_ID,
    'Content-Type': 'application/json',
  };
}

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(access[_-]?key|authorization|secret|token)/i.test(key)
        ? '***redacted***'
        : redactSensitive(item),
    ]));
  }
  if (typeof value === 'string') {
    return value.replace(/([?&](?:secret|token)=)[^&]+/gi, '$1***redacted***');
  }
  return value;
}

/**
 * Registra cada llamada a SIIGO en siigo_sync_log.
 */
async function logSync({
  entidad, entidad_id = null, operacion, endpoint, metodo_http,
  siigo_id = null, request_body = null, response_body = null,
  status_code = null, error_msg = null, duracion_ms = null,
}) {
  await query(
    `INSERT INTO siigo_sync_log
       (entidad, entidad_id, operacion, endpoint, metodo_http,
        siigo_id, request_body, response_body, status_code, error_msg, duracion_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entidad, entidad_id, operacion, endpoint, metodo_http, siigo_id,
      request_body  ? JSON.stringify(redactSensitive(request_body))  : null,
      response_body ? JSON.stringify(redactSensitive(response_body)) : null,
      status_code, error_msg, duracion_ms,
    ]
  );
}

/**
 * Wrapper genérico para cualquier llamada HTTP a SIIGO.
 * - Obtiene token válido automáticamente.
 * - En 401 fuerza re-login y reintenta una vez.
 * - Registra todo en siigo_sync_log.
 */
async function siigoRequest(
  method, path,
  {
    params = null,
    data = null,
    entidad = 'generic',
    entidad_id = null,
    authRetry = true,
    rateLimitRetries = MAX_RATE_LIMIT_RETRIES,
  } = {}
) {
  const startedAt   = Date.now();
  const token       = await getValidToken();
  let statusCode    = null;
  let errorMsg      = null;
  let responseData  = null;

  try {
    const resp = await axios({
      method,
      url:     `${SIIGO_BASE_URL}${path}`,
      params,
      data,
      headers: defaultHeaders(token),
      timeout: 20000,
    });
    statusCode   = resp.status;
    responseData = resp.data;
    return resp.data;
  } catch (err) {
    statusCode = err.response?.status ?? null;
    errorMsg   = err.response?.data ? JSON.stringify(err.response.data) : err.message;

    // Reintento único tras 401 (token inválido — fuerza re-login)
    if (statusCode === 401 && authRetry) {
      await loginSiigo();
      return siigoRequest(method, path, {
        params,
        data,
        entidad,
        entidad_id,
        authRetry: false,
        rateLimitRetries,
      });
    }

    // Only retry reads. Replaying POST/PUT without an idempotency key can
    // create duplicate accounting documents if SIIGO processed the request.
    if (statusCode === 429 && method.toLowerCase() === 'get' && rateLimitRetries > 0) {
      await sleep(getRateLimitDelayMs(err));
      return siigoRequest(method, path, {
        params,
        data,
        entidad,
        entidad_id,
        authRetry,
        rateLimitRetries: rateLimitRetries - 1,
      });
    }
    throw err;
  } finally {
    await logSync({
      entidad, entidad_id,
      operacion:    method.toUpperCase(),
      endpoint:     path,
      metodo_http:  method.toUpperCase(),
      request_body: data,
      response_body: responseData,
      status_code:  statusCode,
      error_msg:    errorMsg,
      duracion_ms:  Date.now() - startedAt,
    }).catch(() => {});
  }
}

const siigoGet  = (path, opts = {})        => siigoRequest('get',  path, opts);
const siigoPost = (path, data, opts = {})  => siigoRequest('post', path, { ...opts, data });
const siigoPut  = (path, data, opts = {})  => siigoRequest('put',  path, { ...opts, data });

module.exports = { loginSiigo, getValidToken, siigoGet, siigoPost, siigoPut, logSync };
