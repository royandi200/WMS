// POST /api/v1/siigo/sync-terceros
// Fase 2 — Sincronización de clientes y proveedores desde SIIGO /v1/customers.
//
// Trae todos los terceros activos (paginado) y hace upsert en tabla `terceros`
// usando `identification` como llave única natural.
// Solo Admin/Supervisor.

const { cors, requireRole } = require('../../_lib/auth');
const { siigoGet }          = require('../../_lib/siigo.service');
const { customerName, fetchCustomersByIdentification, upsertTercero } = require('../../_lib/siigo.terceros');

const PAGE_SIZE = 100;
const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';

function isSharedSandbox() {
  return String(process.env.SIIGO_USERNAME || '').toLowerCase() === SHARED_SANDBOX_USERNAME;
}

function getTestPrefix() {
  return String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).trim().toUpperCase();
}

function getRequestedIdentifications(req) {
  const values = Array.isArray(req.body?.identifications)
    ? req.body.identifications
    : (req.body?.identification ? [req.body.identification] : []);
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function validateSandboxCustomers(customers, identifications) {
  if (!isSharedSandbox()) return;
  const prefix = getTestPrefix();
  if (!identifications.length) {
    throw Object.assign(
      new Error(`En sandbox debes indicar identifications para registros ${prefix}`),
      { status: 400 }
    );
  }

  const invalid = customers.find(customer => {
    const names = `${customerName(customer)} ${customer.commercial_name || ''}`.toUpperCase();
    return !names.includes(prefix);
  });
  if (invalid) {
    throw Object.assign(
      new Error(`El tercero ${invalid.identification || ''} no pertenece a ${prefix}`),
      { status: 400 }
    );
  }
}

async function fetchAllCustomers() {
  const all = [];
  let page  = 1;

  while (true) {
    const resp = await siigoGet('/v1/customers', {
      params:  { page, page_size: PAGE_SIZE },
      entidad: 'tercero',
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
    const requestedIdentifications = getRequestedIdentifications(req);
    if (isSharedSandbox() && !requestedIdentifications.length) {
      return res.status(400).json({
        ok: false,
        error: `En sandbox debes indicar identifications para registros ${getTestPrefix()}`,
      });
    }
    const customers = requestedIdentifications.length
      ? await fetchCustomersByIdentification(requestedIdentifications)
      : await fetchAllCustomers();
    validateSandboxCustomers(customers, requestedIdentifications);

    let creados = 0, actualizados = 0, errores = 0;

    for (const c of customers) {
      try {
        const result = await upsertTercero(c);
        if (result === 'updated') actualizados++;
        if (result === 'created') creados++;
      } catch (err) {
        console.error('[sync-terceros] error en tercero', c.identification, err.message);
        errores++;
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        total_siigo:  customers.length,
        filtro_identifications: requestedIdentifications,
        test_prefix:  isSharedSandbox() ? getTestPrefix() : null,
        creados,
        actualizados,
        errores,
        duracion_ms:  Date.now() - startedAt,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[sync-terceros]', err.message);
    return res.status(500).json({ ok: false, error: 'Error en sincronizacion de terceros' });
  }
};
