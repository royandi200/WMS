const crypto = require('crypto');

const MAX_PDF_BYTES = 2_500_000;

function normalizePurchaseOrderPdf(body = {}) {
  const source = body.documento_pdf || body.purchase_order_pdf || body.pdf || null;
  if (!source || typeof source !== 'object') {
    throw inputError('Debes adjuntar la orden de compra en PDF');
  }

  const name = String(source.nombre || source.name || body.archivo_nombre || '').trim();
  const mimeType = String(source.mime_type || source.type || '').trim().toLowerCase();
  const rawData = String(source.base64 || source.data || '').trim();
  const base64 = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData;

  if (!name || !/\.pdf$/i.test(name)) throw inputError('El archivo debe tener extension .pdf');
  if (mimeType && mimeType !== 'application/pdf') throw inputError('El archivo debe ser application/pdf');
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw inputError('El contenido PDF no es valido');

  const content = Buffer.from(base64, 'base64');
  if (!content.length || content.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw inputError('El archivo no contiene una firma PDF valida');
  }
  if (content.length > MAX_PDF_BYTES) {
    throw inputError(`El PDF supera el limite de ${MAX_PDF_BYTES} bytes`);
  }

  return {
    name: name.slice(0, 255),
    mimeType: 'application/pdf',
    size: content.length,
    hash: crypto.createHash('sha256').update(content).digest('hex'),
    content,
  };
}

function safeDownloadName(value) {
  const normalized = String(value || 'orden-compra.pdf')
    .replace(/[\r\n"\\/]/g, '_')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .slice(0, 180);
  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`;
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = { MAX_PDF_BYTES, normalizePurchaseOrderPdf, safeDownloadName };
