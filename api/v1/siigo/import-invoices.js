const crypto = require('crypto');
const { cors, requireRole } = require('../../_lib/auth');
const { query } = require('../../_lib/db');
const { siigoGet } = require('../../_lib/siigo.service');
const {
  importInvoice,
  cancelImportedInvoice,
  invoiceSignature,
} = require('../../_lib/siigo.invoice-import');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';
const PAGE_SIZE = 50;
const MAX_INCREMENTAL_PAGES = 10;
const MAX_SANDBOX_PAGES = 3;
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const COMPLETED_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isSharedSandbox() {
  return String(process.env.SIIGO_USERNAME || '').toLowerCase() === SHARED_SANDBOX_USERNAME;
}

function testPrefix() {
  return String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).trim().toUpperCase();
}

function requestedIds(req) {
  const values = Array.isArray(req.body?.invoice_ids)
    ? req.body.invoice_ids
    : (req.body?.invoice_id ? [req.body.invoice_id] : []);
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function parseSiigoTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  if (/Z$|[+-]\d{2}:?\d{2}$/i.test(raw)) return Date.parse(raw);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return Date.parse(`${raw}${String(process.env.SIIGO_TIMEZONE_OFFSET || '-05:00')}`);
  }
  return Date.parse(raw);
}

function validateSandboxInvoice(invoice) {
  if (!isSharedSandbox()) return;
  const prefix = testPrefix();
  const codes = (invoice.items || []).map(item => String(item.code || '').toUpperCase());
  if (!codes.length || codes.some(code => !code.startsWith(prefix))) {
    throw Object.assign(new Error(`En sandbox solo se importan facturas con productos ${prefix}`), { status: 400 });
  }
}

async function fetchByIds(ids) {
  const invoices = [];
  for (const id of ids) {
    invoices.push(await siigoGet(`/v1/invoices/${encodeURIComponent(id)}`, {
      entidad: 'factura_importada',
    }));
  }
  return invoices;
}

async function fetchIncremental(since) {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) {
    throw Object.assign(new Error('Cursor de facturas invalido'), { status: 400 });
  }
  const cutoffMs = sinceMs - CURSOR_OVERLAP_MS;
  const invoices = [];
  let page = 1;

  const maxPages = isSharedSandbox() ? MAX_SANDBOX_PAGES : MAX_INCREMENTAL_PAGES;
  while (page <= maxPages) {
    const response = await siigoGet('/v1/invoices', {
      // The shared sandbox returns zero rows for valid updated_start values.
      // Read newest pages there and enforce the cursor locally. Production
      // keeps the documented UTC filter to reduce API traffic.
      params: {
        page,
        page_size: PAGE_SIZE,
        ...(!isSharedSandbox() ? { updated_start: new Date(cutoffMs).toISOString() } : {}),
      },
      entidad: 'factura_importada',
      logResponse: false,
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    if (!results.length) break;

    let reachedCursor = false;
    for (const summary of results) {
      const changedMs = parseSiigoTimestamp(
        summary?.metadata?.last_updated || summary?.metadata?.created || summary?.date || ''
      );
      if (!isSharedSandbox() && Number.isFinite(changedMs) && changedMs < cutoffMs) {
        reachedCursor = true;
        continue;
      }
      if (summary?.annulled === true || !summary?.id) continue;
      if (isSharedSandbox()) {
        const codes = (summary.items || []).map(item => String(item.code || '').toUpperCase());
        if (!codes.some(code => code.startsWith(testPrefix()))) continue;
        if (summary.items?.length && summary.customer) {
          invoices.push(summary);
          continue;
        }
      }
      invoices.push(await siigoGet(`/v1/invoices/${encodeURIComponent(summary.id)}`, {
        entidad: 'factura_importada',
      }));
    }

    if (reachedCursor) break;
    const totalPages = Number(response?.pagination?.total_pages || 0);
    if (results.length < PAGE_SIZE || (totalPages && page >= totalPages)) break;
    page++;
  }
  return invoices;
}

async function getCursor() {
  const rows = await query(`SELECT valor FROM siigo_config WHERE clave = 'invoices_import_cursor' LIMIT 1`);
  return rows[0]?.valor || new Date(Date.now() - 15 * 60 * 1000).toISOString();
}

async function setCursor(value) {
  await query(
    `INSERT INTO siigo_config (clave, valor)
     VALUES ('invoices_import_cursor', ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), actualizado_en = NOW()`,
    [value]
  );
}

async function getConfigValue(key) {
  const rows = await query(`SELECT valor FROM siigo_config WHERE clave = ? LIMIT 1`, [key]);
  return rows[0]?.valor || null;
}

async function setConfigValue(key, value) {
  await query(
    `INSERT INTO siigo_config (clave, valor)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), actualizado_en = NOW()`,
    [key, value]
  );
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function cronUser(req) {
  const expected = process.env.CRON_SECRET;
  const auth = String(req.headers?.authorization || '');
  const received = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!expected) throw Object.assign(new Error('CRON_SECRET no configurado'), { status: 500 });
  if (!safeEqual(received, expected)) throw Object.assign(new Error('Cron no autorizado'), { status: 401 });
  const users = await query(
    `SELECT u.id, u.nombre, u.email, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE u.activo = 1 AND LOWER(r.nombre) IN ('admin', 'supervisor')
     ORDER BY LOWER(r.nombre) = 'admin' DESC, u.id ASC
     LIMIT 1`
  );
  if (!users.length) throw Object.assign(new Error('No hay usuario de sistema para importar facturas'), { status: 500 });
  return users[0];
}

async function reconcilePending(user, excludedIds = new Set()) {
  const pending = await query(
    `SELECT id, siigo_invoice_id, siigo_invoice_name
     FROM despachos
     WHERE estado = 'picking' AND siigo_invoice_id IS NOT NULL
     ORDER BY creado_en ASC
     LIMIT 20`
  );
  const results = [];
  for (const dispatch of pending) {
    if (excludedIds.has(String(dispatch.siigo_invoice_id))) continue;
    try {
      const invoice = await siigoGet(`/v1/invoices/${encodeURIComponent(dispatch.siigo_invoice_id)}`, {
        entidad: 'factura_reconciliada',
        entidad_id: dispatch.id,
      });
      validateSandboxInvoice(invoice);
      if (invoice.annulled === true) {
        results.push(await cancelImportedInvoice(
          dispatch.siigo_invoice_id,
          `Factura ${dispatch.siigo_invoice_name} anulada en SIIGO; reserva liberada`
        ));
      } else {
        results.push(await importInvoice(invoice, user.id));
      }
    } catch (err) {
      const status = err.response?.status || err.status;
      if (status === 404) {
        results.push(await cancelImportedInvoice(
          dispatch.siigo_invoice_id,
          `Factura ${dispatch.siigo_invoice_name} eliminada en SIIGO; reserva liberada`
        ));
      } else {
        results.push({
          status: 'error',
          id: dispatch.id,
          siigo_invoice_id: dispatch.siigo_invoice_id,
          error: err.message,
        });
      }
    }
  }
  return results;
}

async function ensureDispatchIssuesTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS despacho_novedades (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       despacho_id INT UNSIGNED NOT NULL,
       tipo VARCHAR(30) NOT NULL,
       cantidad DECIMAL(15,4) NOT NULL DEFAULT 0,
       motivo TEXT NULL,
       estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
       usuario_id INT UNSIGNED NULL,
       creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       resuelto_en DATETIME NULL,
       INDEX idx_despacho_novedades_despacho (despacho_id),
       INDEX idx_despacho_novedades_estado (estado)
     )`
  );
}

async function addCompletedIssue(dispatch, type, quantity, reason, userId) {
  const existing = await query(
    `SELECT id FROM despacho_novedades
     WHERE despacho_id = ? AND tipo = ? AND estado = 'ABIERTA'
     LIMIT 1`,
    [dispatch.id, type]
  );
  if (existing.length) return false;
  await query(
    `INSERT INTO despacho_novedades
       (despacho_id, tipo, cantidad, motivo, estado, usuario_id, creado_en)
     VALUES (?, ?, ?, ?, 'ABIERTA', ?, NOW())`,
    [dispatch.id, type, Math.max(Number(quantity || 0), 0), reason, userId]
  );
  return true;
}

function signatureQuantity(signature) {
  return signature.reduce((sum, [, quantity]) => sum + Number(quantity || 0), 0);
}

async function reconcileCompleted(user, invoiceIds = [], cachedInvoices = new Map()) {
  await ensureDispatchIssuesTable();
  const ids = [...new Set(invoiceIds.map(value => String(value || '').trim()).filter(Boolean))];
  const idFilter = ids.length ? ` AND d.siigo_invoice_id IN (${ids.map(() => '?').join(',')})` : '';
  const dispatches = await query(
    `SELECT d.id, d.numero, d.siigo_invoice_id, d.siigo_invoice_name
     FROM despachos d
     WHERE d.estado = 'despachado' AND d.siigo_invoice_id IS NOT NULL
       AND d.despachado_en >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       ${idFilter}
     ORDER BY d.despachado_en DESC
     LIMIT 50`,
    ids
  );
  const results = [];
  for (const dispatch of dispatches) {
    try {
      const invoice = cachedInvoices.get(String(dispatch.siigo_invoice_id))
        || await siigoGet(`/v1/invoices/${encodeURIComponent(dispatch.siigo_invoice_id)}`, {
          entidad: 'factura_completada_reconciliada',
          entidad_id: dispatch.id,
        });
      validateSandboxInvoice(invoice);
      if (invoice.annulled === true) {
        const created = await addCompletedIssue(
          dispatch,
          'FACTURA_ANULADA',
          0,
          `La factura ${dispatch.siigo_invoice_name} fue anulada despues del despacho; stock no modificado`,
          user.id
        );
        results.push({ status: created ? 'alert_created' : 'alert_exists', id: dispatch.id, type: 'FACTURA_ANULADA' });
        continue;
      }

      const localItems = await query(
        `SELECT p.siigo_code, di.cantidad_des AS cantidad_sol, di.precio_unitario,
                di.descuento, di.bodega_siigo_id
         FROM despacho_items di
         JOIN productos p ON p.id = di.producto_id
         WHERE di.despacho_id = ?`,
        [dispatch.id]
      );
      const local = invoiceSignature(localItems);
      const remote = invoiceSignature(invoice.items || []);
      if (JSON.stringify(local) !== JSON.stringify(remote)) {
        const created = await addCompletedIssue(
          dispatch,
          'FACTURA_MODIFICADA',
          Math.abs(signatureQuantity(local) - signatureQuantity(remote)),
          `La factura ${dispatch.siigo_invoice_name} cambio despues del despacho; requiere conciliacion manual`,
          user.id
        );
        results.push({ status: created ? 'alert_created' : 'alert_exists', id: dispatch.id, type: 'FACTURA_MODIFICADA' });
      }
    } catch (err) {
      const status = err.response?.status || err.status;
      if (status === 404) {
        const created = await addCompletedIssue(
          dispatch,
          'FACTURA_ELIMINADA',
          0,
          `La factura ${dispatch.siigo_invoice_name} fue eliminada despues del despacho; stock no modificado`,
          user.id
        );
        results.push({ status: created ? 'alert_created' : 'alert_exists', id: dispatch.id, type: 'FACTURA_ELIMINADA' });
      } else {
        results.push({ status: 'error', id: dispatch.id, error: err.message });
      }
    }
  }
  return results;
}

async function shouldReconcileCompleted(force) {
  if (force) return true;
  const last = Date.parse(await getConfigValue('invoices_completed_reconcile_at') || '');
  return !Number.isFinite(last) || Date.now() - last >= COMPLETED_RECONCILE_INTERVAL_MS;
}

module.exports = async (req, res) => {
  cors(res, 'GET,POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const user = req.method === 'GET'
      ? await cronUser(req)
      : await requireRole(req, ['Admin', 'Supervisor', 'Operario']);
    const ids = requestedIds(req);
    const startedAt = new Date();
    const since = String(req.body?.updated_start || req.query?.updated_start || await getCursor());
    const invoices = ids.length ? await fetchByIds(ids) : await fetchIncremental(since);
    const results = [];

    for (const invoice of invoices) {
      try {
        validateSandboxInvoice(invoice);
        results.push(await importInvoice(invoice, user.id));
      } catch (err) {
        results.push({
          status: 'error',
          siigo_invoice_id: invoice?.id || null,
          siigo_invoice_name: invoice?.name || null,
          error: err.message,
        });
      }
    }

    const processedIds = new Set(invoices.map(invoice => String(invoice?.id || '')).filter(Boolean));
    results.push(...await reconcilePending(user, processedIds));

    const forceCompleted = req.body?.reconcile_completed === true
      || req.query?.reconcile_completed === 'true';
    let completedReconciliation = [];
    if (await shouldReconcileCompleted(forceCompleted)) {
      const cachedInvoices = new Map(
        invoices.filter(invoice => invoice?.id).map(invoice => [String(invoice.id), invoice])
      );
      completedReconciliation = await reconcileCompleted(user, ids, cachedInvoices);
      if (!completedReconciliation.some(result => result.status === 'error')) {
        await setConfigValue('invoices_completed_reconcile_at', new Date().toISOString());
      }
    }

    if (!ids.length
        && !results.some(result => result.status === 'error')
        && !completedReconciliation.some(result => result.status === 'error')) {
      await setCursor(startedAt.toISOString());
    }
    const errors = results.filter(result => result.status === 'error').length
      + completedReconciliation.filter(result => result.status === 'error').length;
    return res.status(errors ? 207 : 200).json({
      ok: errors === 0,
      data: {
        mode: ids.length ? 'targeted' : 'incremental',
        since: ids.length ? null : since,
        fetched: invoices.length,
        created: results.filter(result => result.status === 'created').length,
        updated: results.filter(result => result.status === 'updated').length,
        converted: results.filter(result => result.status === 'converted').length,
        duplicates: results.filter(result => result.status === 'duplicate').length,
        cancelled: results.filter(result => result.status === 'cancelled').length,
        errors,
        results,
        completed_reconciliation: completedReconciliation,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[siigo/import-invoices]', err.message);
    return res.status(500).json({ ok: false, error: 'Error importando facturas desde SIIGO' });
  }
};
