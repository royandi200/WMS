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

    if (!ids.length && !results.some(result => result.status === 'error')) {
      await setCursor(startedAt.toISOString());
    }

    const errors = results.filter(result => result.status === 'error').length;
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
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[siigo/import-purchases]', err.message);
    return res.status(500).json({ ok: false, error: 'Error importando compras desde SIIGO' });
  }
};
