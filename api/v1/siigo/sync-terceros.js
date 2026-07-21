// POST /api/v1/siigo/sync-terceros
// Fase 2 — Sincronización de clientes y proveedores desde SIIGO /v1/customers.
//
// Trae todos los terceros activos (paginado) y hace upsert en tabla `terceros`
// usando `identification` como llave única natural.
// Solo Admin/Supervisor.

const { cors, requireRole } = require('../../_lib/auth');
const { query }             = require('../../_lib/db');
const { siigoGet }          = require('../../_lib/siigo.service');

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

function customerName(c) {
  return Array.isArray(c.name)
    ? c.name.map(value => String(value || '').trim()).filter(Boolean).join(' ')
    : String(c.name || '').trim();
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

async function fetchCustomersByIdentification(identifications) {
  const customers = [];
  for (const identification of identifications) {
    const response = await siigoGet('/v1/customers', {
      params: { identification, page: 1, page_size: PAGE_SIZE },
      entidad: 'tercero',
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    customers.push(...results.filter(customer =>
      String(customer.identification || '') === identification
    ));
  }
  return customers;
}

async function upsertTercero(c) {
  const siigoId         = String(c.id              || '');
  const rawPersonType   = String(c.person_type || 'company').replace(/['"]/g, '').toLowerCase();
  const personType      = ['person', 'company'].includes(rawPersonType) ? rawPersonType : 'company';
  const idType          = String(c.id_type?.code || c.id_type?.id || c.id_type || '13');
  const identification  = String(c.identification  || '').trim();
  const checkDigit      = c.check_digit            || null;
  const nombre          = customerName(c);
  const nombreComercial = c.commercial_name        || null;
  const branchOffice    = c.branch_office          ?? 0;
  const vatResponsible  = c.vat_responsible ? 1 : 0;
  const respFiscal      = c.fiscal_responsibilities?.[0]?.code ||
                          c.fiscal_responsibilities?.[0]?.id || 'R-99-PN';
  const address         = c.address || c.addresses?.[0] || {};
  const direccion       = address.address || null;
  const telefono        = c.contacts?.[0]?.phone          || null;
  const emailContacto   = c.contacts?.[0]?.email          || null;
  const sellerId        = c.seller_id                      || null;
  const activo          = c.active !== false ? 1 : 0;

  const tipo = ['Customer', 'Supplier', 'Other'].includes(c.type) ? c.type : 'Customer';

  if (!identification) return 'skip';

  const existing = await query(
    `SELECT id FROM terceros
     WHERE siigo_id = ? OR (identification = ? AND branch_office = ?)
     ORDER BY siigo_id IS NOT NULL DESC
     LIMIT 1`,
    [siigoId, identification, branchOffice]
  );

  if (existing.length) {
    await query(
      `UPDATE terceros
       SET siigo_id = ?, tipo = ?, person_type = ?, id_type = ?,
           identification = ?, check_digit = ?, nombre = ?, nombre_comercial = ?,
           branch_office = ?, activo = ?, vat_responsible = ?,
           responsabilidad_fiscal = ?, direccion = ?, telefono = ?,
           email_contacto = ?, siigo_seller_id = ?, siigo_synced_at = NOW(),
           actualizado_en = NOW()
       WHERE id = ?`,
      [siigoId, tipo, personType, idType, identification, checkDigit,
       nombre, nombreComercial, branchOffice, activo, vatResponsible,
       respFiscal, direccion, telefono, emailContacto, sellerId, existing[0].id]
    );
    return 'updated';
  }

  await query(
    `INSERT INTO terceros
       (siigo_id, tipo, person_type, id_type, identification, check_digit,
        nombre, nombre_comercial, branch_office, activo, vat_responsible,
        responsabilidad_fiscal, direccion, telefono, email_contacto,
        siigo_seller_id, siigo_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       siigo_id              = VALUES(siigo_id),
       tipo                  = VALUES(tipo),
       nombre                = VALUES(nombre),
       nombre_comercial      = VALUES(nombre_comercial),
       activo                = VALUES(activo),
       vat_responsible       = VALUES(vat_responsible),
       responsabilidad_fiscal= VALUES(responsabilidad_fiscal),
       direccion             = VALUES(direccion),
       telefono              = VALUES(telefono),
       email_contacto        = VALUES(email_contacto),
       siigo_seller_id       = VALUES(siigo_seller_id),
       siigo_synced_at       = NOW(),
       actualizado_en        = NOW()`,
    [siigoId, tipo, personType, idType, identification, checkDigit,
     nombre, nombreComercial, branchOffice, activo, vatResponsible,
     respFiscal, direccion, telefono, emailContacto, sellerId]
  );
  return 'created';
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
