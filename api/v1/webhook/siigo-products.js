// POST /api/v1/webhook/siigo-products
// Fase 6 — Listener para eventos SIIGO:
//   public.siigoapi.products.create
//   public.siigoapi.products.update
//
// SIIGO envía un POST con el producto actualizado en el body.
// Hacemos upsert en la tabla local `productos` igual que sync-products.js
// pero para un solo registro en tiempo real.

const crypto = require('crypto');
const { query } = require('../../_lib/db');
const { cors }  = require('../../_lib/auth');

function validateSiigoWebhook(req) {
  const expected = String(process.env.SIIGO_WEBHOOK_SECRET || '');
  const received = String(req.headers?.['x-siigo-webhook-secret'] || req.query?.secret || '');
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (!expected || expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
    const err = new Error('Webhook no autorizado');
    err.status = 401;
    throw err;
  }
}

function shouldIgnoreSandboxProduct(product) {
  if (String(process.env.SIIGO_USERNAME || '').toLowerCase() !== 'sandbox@siigoapi.com') {
    return false;
  }
  const prefix = String(process.env.SIIGO_TEST_PREFIX || 'WMSQA260721').toUpperCase();
  return !String(product.code || '').toUpperCase().startsWith(prefix);
}

async function upsertProductFromWebhook(p) {
  const siigoId      = String(p.id    || '');
  const siigoCode    = String(p.code  || '').trim();
  const nombre       = String(p.name  || '').trim();
  if (!siigoCode) return;

  const tipo         = p.type || 'Product';
  const accountGroup = p.account_group?.id ?? null;
  const controlStock = p.stock_control ? 1 : 0;
  const precio       = p.prices?.[0]?.price_list?.[0]?.value ?? null;
  const unitCode     = String(p.unit?.code || p.unit?.id || '94');
  const unitLabel    = String(p.unit?.name || '');
  const taxClass     = p.tax_classification || 'Taxed';
  const taxIncluded  = p.tax_included ? 1 : 0;
  const activo       = p.active !== false ? 1 : 0;
  const barcode      = p.additional_fields?.barcode || p.barcode || null;

  await query(
    `INSERT INTO productos
       (siigo_id, siigo_code, siigo_account_group, nombre, tipo_producto,
        control_stock, precio_venta, unit_code, unit_label,
        tax_classification, tax_included, barcode, activo, siigo_synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       siigo_id            = VALUES(siigo_id),
       siigo_account_group = VALUES(siigo_account_group),
       nombre              = VALUES(nombre),
       tipo_producto       = VALUES(tipo_producto),
       control_stock       = VALUES(control_stock),
       precio_venta        = VALUES(precio_venta),
       unit_code           = VALUES(unit_code),
       unit_label          = VALUES(unit_label),
       tax_classification  = VALUES(tax_classification),
       tax_included        = VALUES(tax_included),
       barcode             = VALUES(barcode),
       activo              = VALUES(activo),
       siigo_synced_at     = NOW(),
       actualizado_en      = NOW()`,
    [siigoId, siigoCode, accountGroup, nombre, tipo,
     controlStock, precio, unitCode, unitLabel,
     taxClass, taxIncluded, barcode, activo]
  );
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    validateSiigoWebhook(req);

    const body    = req.body || {};
    const product = body.data || body;
    if (!product?.code) {
      return res.status(400).json({ ok: false, error: 'Payload sin campo code' });
    }
    if (shouldIgnoreSandboxProduct(product)) {
      return res.status(200).json({ ok: true, data: { ignored: true } });
    }

    await upsertProductFromWebhook(product);
    console.log('[webhook/siigo-products] upsert', product.code);
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[webhook/siigo-products]', err.message);
    return res.status(500).json({ ok: false, error: 'Error procesando webhook de producto' });
  }
};
