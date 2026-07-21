// POST /api/v1/webhook/siigo-purchases
// Fase 6 — Listener para evento:
//   public.siigoapi.purchases.create
//
// Cuando SIIGO registra una compra, pre-llena una recepción en estado
// 'borrador' para que el operario la confirme al llegar la mercancía.

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
    const body     = req.body || {};
    const purchase = body.data || body;
    const siigoId  = String(purchase.id   || '');
    const siigoName= String(purchase.name || '');

    // Evitar duplicados
    const existing = await query(
      `SELECT id FROM recepciones WHERE siigo_purchase_id = ? LIMIT 1`,
      [siigoId]
    );
    if (existing.length) {
      return res.status(200).json({ ok: true, data: { duplicado: true, id: existing[0].id } });
    }

    // Buscar proveedor
    const supplier    = purchase.supplier || {};
    const terceroRows = await query(
      `SELECT id FROM terceros WHERE siigo_id = ? OR identification = ? LIMIT 1`,
      [String(supplier.id || ''), String(supplier.identification || '')]
    );
    const terceroId = terceroRows[0]?.id || null;

    const conn = await createConnection();
    try {
      await conn.beginTransaction();
      const numero = `REC-SIIGO-${siigoName || Date.now()}`;
      const [res2] = await conn.execute(
        `INSERT INTO recepciones
           (numero, tercero_id, proveedor_nombre, bodega_id, estado,
            usuario_id, siigo_purchase_id, siigo_purchase_name,
            proveedor_invoice_number, proveedor_invoice_date, creado_en)
         VALUES (?, ?, ?, 1, 'borrador', 1, ?, ?, ?, ?, NOW())`,
        [numero, terceroId,
         supplier.name || supplier.business_name || 'PROVEEDOR SIIGO',
         siigoId, siigoName,
         purchase.provider_invoice?.number || null,
         purchase.date || null]
      );
      const recepcionId = res2.insertId;

      // Items de la compra
      const items = purchase.items || [];
      for (const item of items) {
        const prodRows = await query(
          `SELECT id FROM productos WHERE siigo_code = ? LIMIT 1`,
          [String(item.code || '')]
        );
        const productId = prodRows[0]?.id || null;
        if (!productId) continue;

        await conn.execute(
          `INSERT INTO recepcion_items
             (recepcion_id, producto_id, cantidad_esp, cantidad_rec, precio_unitario, descuento)
           VALUES (?, ?, ?, 0, ?, ?)`,
          [recepcionId, productId,
           Number(item.quantity || 1),
           Number(item.price    || 0),
           Number(item.discount || 0)]
        );
      }

      await conn.commit();
      console.log('[webhook/siigo-purchases] recepcion pre-llenada', numero);
      return res.status(200).json({ ok: true, data: { recepcion_id: recepcionId, numero } });
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      await conn.end().catch(() => {});
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[webhook/siigo-purchases]', err.message);
    return res.status(500).json({ ok: false, error: 'Error procesando webhook de compra' });
  }
};
