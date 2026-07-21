// POST /api/v1/webhook/siigo-invoices
// Fase 6 — Listener para eventos SIIGO:
//   public.siigoapi.invoices.create  → genera orden de despacho pendiente
//   public.siigoapi.invoices.void    → anula despacho y revierte reserva de stock

const { query, createConnection } = require('../../_lib/db');
const { cors }                    = require('../../_lib/auth');

function validateSiigoWebhook(req) {
  const partnerId = process.env.SIIGO_PARTNER_ID || 'wms-integration';
  const header = req.headers?.['partner-id'] || req.headers?.['Partner-Id'] || '';
  if (process.env.NODE_ENV === 'production' && header !== partnerId) {
    const err = new Error('Webhook no autorizado');
    err.status = 401;
    throw err;
  }
}

/**
 * invoices.create: crea un despacho en estado 'borrador' con los items
 * de la factura de SIIGO para que el operario haga el picking.
 */
async function handleInvoiceCreate(invoice) {
  const siigoInvoiceId = String(invoice.id   || '');
  const siigoName      = String(invoice.name || '');

  // Evitar duplicados
  const existing = await query(
    `SELECT id FROM despachos WHERE siigo_invoice_id = ? LIMIT 1`,
    [siigoInvoiceId]
  );
  if (existing.length) return { duplicado: true, id: existing[0].id };

  // Buscar tercero por identificacion o siigo_id
  const customer    = invoice.customer || {};
  const terceroRows = await query(
    `SELECT id FROM terceros WHERE siigo_id = ? OR identification = ? LIMIT 1`,
    [String(customer.id || ''), String(customer.identification || '')]
  );
  const terceroId = terceroRows[0]?.id || null;

  const conn = await createConnection();
  try {
    await conn.beginTransaction();

    const numero = `DSP-SIIGO-${siigoName || Date.now()}`;
    const [res] = await conn.execute(
      `INSERT INTO despachos
         (numero, tercero_id, cliente_nombre, bodega_id, estado,
          usuario_id, siigo_invoice_id, siigo_invoice_name, creado_en)
       VALUES (?, ?, ?, 1, 'borrador', 1, ?, ?, NOW())`,
      [numero, terceroId,
       customer.name || customer.business_name || 'CLIENTE SIIGO',
       siigoInvoiceId, siigoName]
    );
    const despachoId = res.insertId;

    // Insertar items
    const items = invoice.items || [];
    for (const item of items) {
      const prodRows = await query(
        `SELECT id FROM productos WHERE siigo_code = ? LIMIT 1`,
        [String(item.code || '')]
      );
      const productId = prodRows[0]?.id || null;
      if (!productId) continue;

      await conn.execute(
        `INSERT INTO despacho_items
           (despacho_id, producto_id, cantidad_sol, cantidad_des, precio_unitario, descuento)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [despachoId, productId,
         Number(item.quantity || 1),
         Number(item.price    || 0),
         Number(item.discount || 0)]
      );
    }

    await conn.commit();
    return { ok: true, despacho_id: despachoId, numero };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end().catch(() => {});
  }
}

/**
 * invoices.void: marca el despacho como anulado y
 * revierte stock reservado si aún no se descontaba.
 */
async function handleInvoiceVoid(invoice) {
  const siigoInvoiceId = String(invoice.id || '');
  const rows = await query(
    `SELECT id, estado FROM despachos WHERE siigo_invoice_id = ? LIMIT 1`,
    [siigoInvoiceId]
  );
  if (!rows.length) return { not_found: true };

  const desp = rows[0];
  if (desp.estado === 'anulado') return { ya_anulado: true };

  await query(
    `UPDATE despachos SET estado = 'anulado', siigo_synced_at = NOW() WHERE id = ?`,
    [desp.id]
  );

  // Revertir stock reservado de los items que no se despacharon
  await query(
    `UPDATE stock s
     JOIN despacho_items di ON di.producto_id = s.producto_id AND di.lote = s.lote
     SET s.reservada = GREATEST(0, s.reservada - di.cantidad_sol)
     WHERE di.despacho_id = ? AND di.cantidad_des = 0`,
    [desp.id]
  ).catch(() => {});

  return { ok: true, despacho_id: desp.id, anulado: true };
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    validateSiigoWebhook(req);
    const body    = req.body || {};
    const event   = body.event   || '';
    const invoice = body.data    || body;

    let result;
    if (event.includes('void') || invoice.status === 'void') {
      result = await handleInvoiceVoid(invoice);
    } else {
      result = await handleInvoiceCreate(invoice);
    }

    console.log('[webhook/siigo-invoices]', event || 'create', result);
    return res.status(200).json({ ok: true, data: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[webhook/siigo-invoices]', err.message);
    return res.status(500).json({ ok: false, error: 'Error procesando webhook de factura' });
  }
};
