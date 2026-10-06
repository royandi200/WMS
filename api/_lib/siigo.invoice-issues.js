// Facturas de venta de SIIGO que no pudieron convertirse en despacho.
//
// Cada fallo de importación queda registrado una sola vez por factura, con
// un tipo legible y los códigos involucrados, para que un usuario del WMS lo
// vea en Despachos > Novedades SIIGO y lo corrija (sincronizar el producto,
// reintentar o descartar). Al importarse con éxito la novedad se resuelve.
const { query } = require('./db');

const RETRY_AFTER_MINUTES = 10;
const AUTO_RETRY_LIMIT = 5;

let tableReady = false;
async function ensureInvoiceIssuesTable() {
  if (tableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS siigo_factura_novedades (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       siigo_invoice_id VARCHAR(80) NOT NULL,
       siigo_invoice_name VARCHAR(80) NULL,
       fecha_factura DATE NULL,
       cliente_identificacion VARCHAR(40) NULL,
       tipo VARCHAR(40) NOT NULL,
       detalle TEXT NULL,
       codigos TEXT NULL,
       estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
       intentos INT UNSIGNED NOT NULL DEFAULT 1,
       primera_vez DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       ultimo_intento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       resuelta_en DATETIME NULL,
       resuelta_por INT UNSIGNED NULL,
       nota VARCHAR(255) NULL,
       UNIQUE KEY uk_siigo_factura_novedad (siigo_invoice_id),
       INDEX idx_siigo_factura_novedad_estado (estado)
     )`
  );
  tableReady = true;
}

function classifyImportError(message) {
  const text = String(message || '');
  const missing = text.match(/Productos no sincronizados:\s*(.+)$/iu);
  if (missing) {
    return {
      tipo: 'PRODUCTO_NO_SINCRONIZADO',
      codigos: missing[1].split(',').map(code => code.trim()).filter(Boolean),
    };
  }
  if (/multiples bodegas/iu.test(text)) return { tipo: 'BODEGAS_MULTIPLES', codigos: [] };
  if (/no esta mapeada/iu.test(text)) return { tipo: 'BODEGA_NO_MAPEADA', codigos: [] };
  if (/cotizaci[oó]n/iu.test(text)) return { tipo: 'COTIZACION', codigos: [] };
  if (/sin items|sin codigos/iu.test(text)) return { tipo: 'FACTURA_SIN_PRODUCTOS', codigos: [] };
  return { tipo: 'OTRO', codigos: [] };
}

async function recordInvoiceIssue(invoice, error) {
  await ensureInvoiceIssuesTable();
  const id = String(invoice?.id || '').trim();
  if (!id) return false;
  const { tipo, codigos } = classifyImportError(error?.message);
  const date = String(invoice?.date || '').slice(0, 10);
  await query(
    `INSERT INTO siigo_factura_novedades
       (siigo_invoice_id, siigo_invoice_name, fecha_factura, cliente_identificacion,
        tipo, detalle, codigos)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       siigo_invoice_name = VALUES(siigo_invoice_name),
       fecha_factura = VALUES(fecha_factura),
       tipo = VALUES(tipo),
       detalle = VALUES(detalle),
       codigos = VALUES(codigos),
       intentos = intentos + 1,
       ultimo_intento = NOW(),
       resuelta_en = IF(estado = 'DESCARTADA', resuelta_en, NULL),
       estado = IF(estado = 'DESCARTADA', 'DESCARTADA', 'ABIERTA')`,
    [id, String(invoice?.name || '').trim() || null,
      /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : null,
      String(invoice?.customer?.identification || '').trim() || null,
      tipo, String(error?.message || 'Error desconocido').slice(0, 2000),
      codigos.length ? JSON.stringify(codigos) : null]
  );
  return true;
}

async function resolveInvoiceIssue(invoiceId, { userId = null, nota = null, estado = 'RESUELTA' } = {}) {
  await ensureInvoiceIssuesTable();
  await query(
    `UPDATE siigo_factura_novedades
        SET estado = ?, resuelta_en = NOW(), resuelta_por = ?, nota = COALESCE(?, nota)
      WHERE siigo_invoice_id = ? AND estado <> ?`,
    [estado, userId, nota, String(invoiceId), estado]
  );
}

// Novedades abiertas que no se han intentado en los últimos minutos; el cron
// las reintenta solas para que, al sincronizar un producto, la factura pase sin
// que nadie tenga que pulsar nada.
async function issuesDueForRetry(excludedIds = new Set()) {
  await ensureInvoiceIssuesTable();
  const rows = await query(
    `SELECT siigo_invoice_id FROM siigo_factura_novedades
      WHERE estado = 'ABIERTA'
        AND ultimo_intento < DATE_SUB(NOW(), INTERVAL ${RETRY_AFTER_MINUTES} MINUTE)
      ORDER BY ultimo_intento ASC
      LIMIT ${AUTO_RETRY_LIMIT + excludedIds.size}`
  );
  return rows.map(row => String(row.siigo_invoice_id))
    .filter(id => !excludedIds.has(id))
    .slice(0, AUTO_RETRY_LIMIT);
}

async function listInvoiceIssues({ includeClosed = false } = {}) {
  await ensureInvoiceIssuesTable();
  const rows = await query(
    `SELECT n.*, u.nombre AS resuelta_por_nombre
       FROM siigo_factura_novedades n
       LEFT JOIN usuarios u ON u.id = n.resuelta_por
      ${includeClosed ? `WHERE n.estado = 'ABIERTA' OR n.resuelta_en >= DATE_SUB(NOW(), INTERVAL 7 DAY)` : `WHERE n.estado = 'ABIERTA'`}
      ORDER BY n.estado = 'ABIERTA' DESC, n.ultimo_intento DESC
      LIMIT 200`
  );
  return rows.map(row => ({
    ...row,
    codigos: (() => { try { return row.codigos ? JSON.parse(row.codigos) : []; } catch { return []; } })(),
  }));
}

module.exports = {
  AUTO_RETRY_LIMIT,
  classifyImportError,
  ensureInvoiceIssuesTable,
  issuesDueForRetry,
  listInvoiceIssues,
  recordInvoiceIssue,
  resolveInvoiceIssue,
};
