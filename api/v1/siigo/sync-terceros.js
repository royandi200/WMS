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

async function upsertTercero(c) {
  const siigoId         = String(c.id              || '');
  const personType      = c.person_type            || 'company';
  const idType          = String(c.id_type?.id     || '13');
  const identification  = String(c.identification  || '').trim();
  const checkDigit      = c.check_digit            || null;
  const nombre          = String(c.name            || '').trim();
  const nombreComercial = c.commercial_name        || null;
  const branchOffice    = c.branch_office          ?? 0;
  const vatResponsible  = c.vat_responsible ? 1 : 0;
  const respFiscal      = c.fiscal_responsibilities?.[0]?.id || 'R-99-PN';
  const direccion       = c.addresses?.[0]?.address       || null;
  const cityCode        = String(c.addresses?.[0]?.city?.country_code || '');
  const telefono        = c.contacts?.[0]?.phone          || null;
  const emailContacto   = c.contacts?.[0]?.email          || null;
  const sellerId        = c.seller_id                      || null;
  const activo          = c.active !== false ? 1 : 0;

  // tipo: si tiene tipo de comprobante de compra es Supplier, por defecto Customer
  const tipo = c.type === 'Supplier' ? 'Supplier' : 'Customer';

  if (!identification) return 'skip';

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
  return 'ok';
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
    const customers = await fetchAllCustomers();

    let creados = 0, actualizados = 0, errores = 0;

    for (const c of customers) {
      try {
        const existing = await query(
          `SELECT id FROM terceros WHERE identification = ? LIMIT 1`,
          [String(c.identification || '').trim()]
        );
        await upsertTercero(c);
        existing.length ? actualizados++ : creados++;
      } catch (err) {
        console.error('[sync-terceros] error en tercero', c.identification, err.message);
        errores++;
      }
    }

    return res.status(200).json({
      ok: true,
      data: {
        total_siigo:  customers.length,
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
