// POST /api/v1/siigo/sync-products
// Fase 2 — Sincronización del catálogo de productos desde SIIGO.
//
// Trae TODOS los productos activos de SIIGO via GET /v1/products (paginado)
// y hace upsert en la tabla local `productos` usando siigo_code como llave.
// Guarda siigo_id, nombre, precio, tipo, unidad, tax, etc.
// Solo Admin/Supervisor pueden dispararlo.

const { cors, requireRole } = require('../../_lib/auth');
const { query }             = require('../../_lib/db');
const { siigoGet }          = require('../../_lib/siigo.service');
const { PAGE_SIZE, fetchProductsByCode, upsertProduct } = require('../../_lib/siigo.product-sync');
const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';

function isSharedSandbox() {
  return String(process.env.SIIGO_USERNAME || '').toLowerCase() === SHARED_SANDBOX_USERNAME;
}

function getTestPrefix() {
  return String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).trim().toUpperCase();
}

function getRequestedCodes(req) {
  const values = Array.isArray(req.body?.codes)
    ? req.body.codes
    : (req.body?.code ? [req.body.code] : []);
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function validateSandboxCodes(codes) {
  if (!isSharedSandbox()) return;
  const prefix = getTestPrefix();
  if (!codes.length) {
    throw Object.assign(
      new Error(`En sandbox debes indicar codes y usar el prefijo ${prefix}`),
      { status: 400 }
    );
  }
  if (codes.some(code => !code.toUpperCase().startsWith(prefix))) {
    throw Object.assign(
      new Error(`Solo se permiten productos con prefijo ${prefix} en sandbox`),
      { status: 400 }
    );
  }
}

/**
 * Trae todos los productos de SIIGO iterando por páginas.
 * SIIGO usa query params: ?page=1&page_size=100
 * La respuesta tiene la forma: { pagination: { total_results, ... }, results: [...] }
 */
async function fetchAllProducts() {
  const all = [];
  let page  = 1;

  while (true) {
    const resp = await siigoGet('/v1/products', {
      params:   { page, page_size: PAGE_SIZE },
      entidad:  'producto',
    });

    const results = resp?.results ?? (Array.isArray(resp) ? resp : []);
    if (!results.length) break;

    all.push(...results);

    const total = resp?.pagination?.total_results ?? results.length;
    if (all.length >= total) break;
    page++;
  }

  return all;
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin', 'Supervisor']);
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const startedAt = Date.now();
    const requestedCodes = getRequestedCodes(req);
    validateSandboxCodes(requestedCodes);
    const products = requestedCodes.length
      ? await fetchProductsByCode(requestedCodes)
      : await fetchAllProducts();

    let creados = 0, actualizados = 0, errores = 0;

    for (const p of products) {
      try {
        // Para distinguir INSERT vs UPDATE leer antes si existe
        const existing = await query(
          `SELECT id FROM productos WHERE siigo_code = ? LIMIT 1`,
          [String(p.code || '').trim()]
        );
        await upsertProduct(p);
        existing.length ? actualizados++ : creados++;
      } catch (err) {
        console.error('[sync-products] error en producto', p.code, err.message);
        errores++;
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        total_siigo:  products.length,
        filtro_codes: requestedCodes,
        test_prefix:  isSharedSandbox() ? getTestPrefix() : null,
        creados,
        actualizados,
        errores,
        duracion_ms:  Date.now() - startedAt,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[sync-products]', err.message);
    return res.status(500).json({ ok: false, error: 'Error en sincronizacion de productos' });
  }
};
