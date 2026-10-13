const { query } = require('./db');
const { siigoGet } = require('./siigo.service');

const PAGE_SIZE = 100;

function customerName(c) {
  return Array.isArray(c.name)
    ? c.name.map(value => String(value || '').trim()).filter(Boolean).join(' ')
    : String(c.name || '').trim();
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

// Brings an invoice customer that the WMS does not know yet from SIIGO, so the
// dispatch is not left waiting for customer data.
async function ensureInvoiceCustomer(invoice) {
  const customer = invoice?.customer || {};
  const siigoId = String(customer.id || '').trim();
  const identification = String(customer.identification || '').trim();
  if (!identification) return 'skip';
  const existing = await query(
    `SELECT id FROM terceros WHERE siigo_id = ? OR identification = ? LIMIT 1`,
    [siigoId, identification]
  );
  if (existing.length) return 'exists';
  const customers = await fetchCustomersByIdentification([identification]);
  const match = customers.find(c => !siigoId || String(c.id || '') === siigoId) || customers[0];
  return match ? upsertTercero(match) : 'not_found';
}

module.exports = { customerName, fetchCustomersByIdentification, upsertTercero, ensureInvoiceCustomer };
