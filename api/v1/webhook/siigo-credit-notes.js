// POST /api/v1/webhook/siigo-credit-notes
// Fase 6 — Listener para evento:
//   public.siigoapi.credit-notes.create
//
// Registra automáticamente una devolución de stock cuando SIIGO
// emite una nota crédito asociada a una factura de venta.

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

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    validateSiigoWebhook(req);
    const body       = req.body || {};
    const creditNote = body.data || body;
    const siigoNcId  = String(creditNote.id   || '');
    const siigoName  = String(creditNote.name || '');

    // Buscar despacho original por siigo_invoice_id del campo referenced_invoice
    const refInvoiceId = String(creditNote.referenced_invoice?.id || '');
    const despRows = refInvoiceId
      ? await query(
          `SELECT id, numero FROM despachos WHERE siigo_invoice_id = ? LIMIT 1`,
          [refInvoiceId]
        )
      : [];
    const despachoRef = despRows[0] || null;

    const conn = await createConnection();
    try {
      await conn.beginTransaction();

      const items = creditNote.items || [];
      let stockRestored = 0;

      for (const item of items) {
        const prodRows = await query(
          `SELECT id FROM productos WHERE siigo_code = ? LIMIT 1`,
          [String(item.code || '')]
        );
        const productId = prodRows[0]?.id || null;
        if (!productId) continue;

        const qty = Number(item.quantity || 0);
        if (qty <= 0) continue;

        // Restaurar stock en bodega por defecto (sin lote específico — FIFO implícito)
        await conn.execute(
          `UPDATE stock
           SET cantidad = cantidad + ?, actualizado_en = NOW()
           WHERE producto_id = ? AND bodega_id = 1
           ORDER BY actualizado_en ASC
           LIMIT 1`,
          [qty, productId]
        );

        // Registrar movimiento de devolución
        await conn.execute(
          `INSERT INTO movimientos
             (tipo, producto_id, bodega_dest, cantidad,
              referencia_tipo, usuario_id, siigo_sync, siigo_voucher_id, creado_en)
           VALUES ('entrada', ?, 1, ?, 'devolucion_nc', 1, 1, ?, NOW())`,
          [productId, qty, siigoNcId]
        );
        stockRestored += qty;
      }

      await conn.commit();
      console.log('[webhook/siigo-credit-notes]', siigoName, 'stock_restored:', stockRestored);
      return res.status(200).json({
        ok: true,
        data: {
          nota_credito:    siigoName,
          despacho_ref:    despachoRef?.numero || null,
          stock_restored:  stockRestored,
        },
      });
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      await conn.end().catch(() => {});
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[webhook/siigo-credit-notes]', err.message);
    return res.status(500).json({ ok: false, error: 'Error procesando nota credito' });
  }
};
