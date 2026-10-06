// GET  /api/v1/siigo/novedades[?all=true]  -> facturas de SIIGO que no pasaron al WMS
// POST /api/v1/siigo/novedades { action, invoice_id, motivo? }
//   retry           reintenta importar la factura (siigo.poll)
//   sync_and_retry  trae de SIIGO los productos faltantes y reintenta (siigo.sync)
//   dismiss         la marca como descartada con un motivo (siigo.sync)
const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { query } = require('../../_lib/db');
const { listInvoiceIssues, resolveInvoiceIssue } = require('../../_lib/siigo.invoice-issues');
const { syncProductCodes } = require('../../_lib/siigo.product-sync');
const { retryInvoiceById } = require('./import-invoices');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function findIssue(invoiceId) {
  const rows = await query(
    `SELECT siigo_invoice_id, siigo_invoice_name, estado, codigos
       FROM siigo_factura_novedades WHERE siigo_invoice_id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!rows.length) throw httpError(404, 'Novedad no encontrada');
  return rows[0];
}

async function handlePost(req, res) {
  const action = String(req.body?.action || '').trim();
  const invoiceId = String(req.body?.invoice_id || '').trim();
  if (!invoiceId) throw httpError(400, 'invoice_id es obligatorio');

  if (action === 'retry') {
    const user = await requireCapability(req, CAPABILITIES.SIIGO_POLL);
    await findIssue(invoiceId);
    return res.status(200).json({ ok: true, data: { result: await retryInvoiceById(invoiceId, user) } });
  }

  if (action === 'sync_and_retry') {
    const user = await requireCapability(req, CAPABILITIES.SIIGO_SYNC);
    const issue = await findIssue(invoiceId);
    let codes = [];
    try { codes = JSON.parse(issue.codigos || '[]'); } catch { codes = []; }
    if (!codes.length) throw httpError(409, 'Esta novedad no tiene productos por sincronizar');
    const sync = await syncProductCodes(codes);
    if (sync.notFound.length) {
      return res.status(409).json({
        ok: false,
        error: `SIIGO no devolvió ${sync.notFound.join(', ')}. Revisa que el código exista en SIIGO tal como está en la factura.`,
        data: { sync },
      });
    }
    return res.status(200).json({ ok: true, data: { sync, result: await retryInvoiceById(invoiceId, user) } });
  }

  if (action === 'dismiss') {
    const user = await requireCapability(req, CAPABILITIES.SIIGO_SYNC);
    const reason = String(req.body?.motivo || '').trim();
    if (reason.length < 5) throw httpError(400, 'Escribe un motivo de al menos 5 caracteres');
    await findIssue(invoiceId);
    await resolveInvoiceIssue(invoiceId, { userId: user.id, nota: reason.slice(0, 255), estado: 'DESCARTADA' });
    return res.status(200).json({ ok: true, data: { invoice_id: invoiceId, estado: 'DESCARTADA' } });
  }

  throw httpError(400, 'Acción no soportada');
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      await requireCapability(req, CAPABILITIES.DISPATCH_READ);
      const rows = await listInvoiceIssues({ includeClosed: req.query?.all === 'true' });
      return res.status(200).json({ ok: true, data: { rows, open: rows.filter(row => row.estado === 'ABIERTA').length } });
    }
    if (req.method === 'POST') return await handlePost(req, res);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[siigo/novedades]', error.message);
    return res.status(500).json({ ok: false, error: 'Error al procesar novedades de SIIGO' });
  }
};
