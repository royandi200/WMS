const crypto = require('crypto');
const { cors, requireRole } = require('../../_lib/auth');
const { query } = require('../../_lib/db');
const { siigoGet } = require('../../_lib/siigo.service');
const { importPurchase } = require('../../_lib/siigo.purchase-import');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';
const PAGE_SIZE = 50;
const MAX_INCREMENTAL_PAGES = 10;
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const COMPLETED_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isSharedSandbox() {
  return String(process.env.SIIGO_USERNAME || '').toLowerCase() === SHARED_SANDBOX_USERNAME;
}

function testPrefix() {
  return String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).trim().toUpperCase();
}

function requestedIds(req) {
  const values = Array.isArray(req.body?.purchase_ids)
    ? req.body.purchase_ids
    : (req.body?.purchase_id ? [req.body.purchase_id] : []);
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function parseSiigoTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  if (/Z$|[+-]\d{2}:?\d{2}$/i.test(raw)) return Date.parse(raw);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const offset = String(process.env.SIIGO_TIMEZONE_OFFSET || '-05:00');
    return Date.parse(`${raw}${offset}`);
  }
  return Date.parse(raw);
}

function validateSandboxPurchase(purchase) {
  if (!isSharedSandbox()) return;
  const prefix = testPrefix();
  const codes = (purchase.items || []).map(item => String(item.code || '').toUpperCase());
  const invoicePrefix = String(purchase.provider_invoice?.prefix || '').toUpperCase();
  if (!codes.length || codes.some(code => !code.startsWith(prefix)) || invoicePrefix !== 'WQA') {
    throw Object.assign(new Error(`En sandbox solo se importan compras ${prefix} con prefijo WQA`), { status: 400 });
  }
}

async function fetchByIds(ids) {
  const purchases = [];
  for (const id of ids) {
    purchases.push(await siigoGet(`/v1/purchases/${encodeURIComponent(id)}`, {
      entidad: 'compra_importada',
    }));
  }
  return purchases;
}

async function fetchIncremental(since) {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) {
    throw Object.assign(new Error('Cursor de compras invalido'), { status: 400 });
  }
  const cutoffMs = sinceMs - CURSOR_OVERLAP_MS;
  const purchases = [];
  let page = 1;
  while (page <= MAX_INCREMENTAL_PAGES) {
    const response = await siigoGet('/v1/purchases', {
      // SIIGO currently ignores date filters for purchases. Read newest pages
      // and stop as soon as the local cursor (with overlap) is reached.
      params: { page, page_size: PAGE_SIZE },
      entidad: 'compra_importada',
      logResponse: false,
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    if (!results.length) break;

    let reachedCursor = false;
    for (const purchase of results) {
      const createdMs = parseSiigoTimestamp(purchase?.metadata?.created || purchase?.date || '');
      if (Number.isFinite(createdMs) && createdMs < cutoffMs) {
        reachedCursor = true;
        continue;
      }
      if (!isSharedSandbox() || String(purchase?.provider_invoice?.prefix || '').toUpperCase() === 'WQA') {
        purchases.push(purchase);
      }
    }
    if (reachedCursor) break;
    page++;
  }
  return purchases;
}

async function getCursor() {
  const rows = await query(`SELECT valor FROM siigo_config WHERE clave = 'purchases_import_cursor' LIMIT 1`);
  if (rows[0]?.valor) return rows[0].valor;
  return new Date(Date.now() - 15 * 60 * 1000).toISOString();
}

async function setCursor(value) {
  await query(
    `INSERT INTO siigo_config (clave, valor)
     VALUES ('purchases_import_cursor', ?)
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
  if (!safeEqual(received, expected)) {
    throw Object.assign(new Error('Cron no autorizado'), { status: 401 });
  }
  const users = await query(
    `SELECT u.id, u.nombre, u.email, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE u.activo = 1 AND LOWER(r.nombre) IN ('admin', 'supervisor')
     ORDER BY LOWER(r.nombre) = 'admin' DESC, u.id ASC
     LIMIT 1`
  );
  if (!users.length) throw Object.assign(new Error('No hay usuario de sistema para importar compras'), { status: 500 });
  return users[0];
}

async function reconcilePending(user) {
  const pending = await query(
    `SELECT id, siigo_purchase_id, siigo_purchase_name
     FROM recepciones
     WHERE estado = 'borrador' AND siigo_purchase_id IS NOT NULL
     ORDER BY creado_en ASC
     LIMIT 20`
  );
  const results = [];
  for (const reception of pending) {
    try {
      const purchase = await siigoGet(`/v1/purchases/${encodeURIComponent(reception.siigo_purchase_id)}`, {
        entidad: 'compra_reconciliada',
        entidad_id: reception.id,
      });
      validateSandboxPurchase(purchase);
      results.push(await importPurchase(purchase, user.id));
    } catch (err) {
      const status = err.response?.status || err.status;
      if (status === 404) {
        await query(
          `UPDATE recepciones
           SET estado = 'anulada',
               observaciones = CONCAT(COALESCE(observaciones, ''), '\nFactura eliminada en SIIGO; borrador anulado por conciliacion')
           WHERE id = ? AND estado = 'borrador'`,
          [reception.id]
        );
        results.push({
          status: 'cancelled',
          id: reception.id,
          siigo_purchase_id: reception.siigo_purchase_id,
        });
      } else {
        results.push({
          status: 'error',
          id: reception.id,
          siigo_purchase_id: reception.siigo_purchase_id,
          error: err.message,
        });
      }
    }
  }
  return results;
}

function accountingSignature(items) {
  return items.map(item => ({
    code: String(item.code || item.siigo_code || '').trim(),
    quantity: Number(item.quantity ?? item.cantidad_esp ?? 0),
    price: Number(item.price ?? item.precio_unitario ?? 0),
    discount: Number(item.discount ?? item.descuento ?? 0),
    warehouse: Number(item.warehouse?.id ?? item.warehouse ?? item.bodega_siigo_id ?? 0),
  })).sort((left, right) => left.code.localeCompare(right.code));
}

async function addCompletedIssue(reception, type, quantity, reason, userId) {
  const existing = await query(
    `SELECT id FROM recepcion_novedades
     WHERE recepcion_id = ? AND tipo = ? AND estado = 'ABIERTA'
     LIMIT 1`,
    [reception.id, type]
  );
  if (existing.length) return false;
  await query(
    `INSERT INTO recepcion_novedades
       (recepcion_id, recepcion_item_id, tipo, cantidad, motivo, estado, usuario_id, creado_en)
     VALUES (?, ?, ?, ?, ?, 'ABIERTA', ?, NOW())`,
    [reception.id, reception.item_id, type, Math.max(Number(quantity || 0), 0), reason, userId]
  );
  return true;
}

async function ensureReceptionIssuesTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS recepcion_novedades (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       recepcion_id INT UNSIGNED NOT NULL,
       recepcion_item_id INT UNSIGNED NOT NULL,
       tipo VARCHAR(30) NOT NULL,
       cantidad DECIMAL(15,4) NOT NULL,
       motivo TEXT NULL,
       estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
       usuario_id INT UNSIGNED NULL,
       creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       resuelto_en DATETIME NULL,
       INDEX idx_recepcion_novedades_recepcion (recepcion_id),
       INDEX idx_recepcion_novedades_estado (estado)
     )`
  );
}

async function reconcileCompleted(user) {
  await ensureReceptionIssuesTable();
  const receptions = await query(
    `SELECT r.id, r.numero, r.siigo_purchase_id, r.siigo_purchase_name,
            MIN(ri.id) AS item_id
     FROM recepciones r
     JOIN recepcion_items ri ON ri.recepcion_id = r.id
     WHERE r.estado = 'completada' AND r.siigo_purchase_id IS NOT NULL
       AND r.completado_en >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY r.id, r.numero, r.siigo_purchase_id, r.siigo_purchase_name
     ORDER BY r.completado_en DESC
     LIMIT 50`
  );
  const results = [];
  for (const reception of receptions) {
    try {
      const purchase = await siigoGet(`/v1/purchases/${encodeURIComponent(reception.siigo_purchase_id)}`, {
        entidad: 'compra_completada_reconciliada',
        entidad_id: reception.id,
      });
      validateSandboxPurchase(purchase);
      const localItems = await query(
        `SELECT p.siigo_code, ri.cantidad_esp, ri.precio_unitario,
                ri.descuento, ri.bodega_siigo_id
         FROM recepcion_items ri
         JOIN productos p ON p.id = ri.producto_id
         WHERE ri.recepcion_id = ?`,
        [reception.id]
      );
      const local = accountingSignature(localItems);
      const remote = accountingSignature(purchase.items || []);
      if (JSON.stringify(local) !== JSON.stringify(remote)) {
        const localQty = local.reduce((sum, item) => sum + item.quantity, 0);
        const remoteQty = remote.reduce((sum, item) => sum + item.quantity, 0);
        const created = await addCompletedIssue(
          reception,
          'FACTURA_MODIFICADA',
          Math.abs(localQty - remoteQty),
          `La factura ${reception.siigo_purchase_name} cambio despues de completar la recepcion; requiere conciliacion manual`,
          user.id
        );
        results.push({ status: created ? 'alert_created' : 'alert_exists', id: reception.id, type: 'FACTURA_MODIFICADA' });
      }
    } catch (err) {
      const status = err.response?.status || err.status;
      if (status === 404) {
        const created = await addCompletedIssue(
          reception,
          'FACTURA_ELIMINADA',
          0,
          `La factura ${reception.siigo_purchase_name} fue eliminada despues de completar la recepcion; stock no modificado`,
          user.id
        );
        results.push({ status: created ? 'alert_created' : 'alert_exists', id: reception.id, type: 'FACTURA_ELIMINADA' });
      } else {
        results.push({ status: 'error', id: reception.id, error: err.message });
      }
    }
  }
  return results;
}

async function shouldReconcileCompleted(force) {
  if (force) return true;
  const last = Date.parse(await getConfigValue('purchases_completed_reconcile_at') || '');
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
      : await requireRole(req, ['Admin', 'Supervisor']);
    const ids = requestedIds(req);

    const startedAt = new Date();
    const since = String(req.body?.updated_start || req.query?.updated_start || await getCursor());
    const purchases = ids.length ? await fetchByIds(ids) : await fetchIncremental(since);
    const results = [];

    for (const purchase of purchases) {
      try {
        validateSandboxPurchase(purchase);
        results.push(await importPurchase(purchase, user.id));
      } catch (err) {
        results.push({
          status: 'error',
          siigo_purchase_id: purchase?.id || null,
          siigo_purchase_name: purchase?.name || null,
          error: err.message,
        });
      }
    }

    const reconciliation = await reconcilePending(user);
    results.push(...reconciliation);

    const forceCompleted = req.body?.reconcile_completed === true || req.query?.reconcile_completed === 'true';
    let completedReconciliation = [];
    if (await shouldReconcileCompleted(forceCompleted)) {
      completedReconciliation = await reconcileCompleted(user);
      if (!completedReconciliation.some(result => result.status === 'error')) {
        await setConfigValue('purchases_completed_reconcile_at', new Date().toISOString());
      }
    }

    if (!ids.length && !results.some(result => result.status === 'error')) {
      await setCursor(startedAt.toISOString());
    }

    const errors = results.filter(result => result.status === 'error').length
      + completedReconciliation.filter(result => result.status === 'error').length;
    return res.status(errors ? 207 : 200).json({
      ok: errors === 0,
      data: {
        mode: ids.length ? 'targeted' : 'incremental',
        since: ids.length ? null : since,
        fetched: purchases.length,
        created: results.filter(result => result.status === 'created').length,
        updated: results.filter(result => result.status === 'updated').length,
        duplicates: results.filter(result => result.status === 'duplicate').length,
        cancelled: results.filter(result => result.status === 'cancelled').length,
        errors,
        results,
        completed_reconciliation: completedReconciliation,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[siigo/import-purchases]', err.message);
    return res.status(500).json({ ok: false, error: 'Error importando compras desde SIIGO' });
  }
};
