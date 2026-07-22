const crypto = require('crypto');
const { cors, requireRole } = require('../../_lib/auth');
const { query } = require('../../_lib/db');
const { siigoGet } = require('../../_lib/siigo.service');
const { importInvoice } = require('../../_lib/siigo.invoice-import');

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

function siigoLocalTimestamp(epochMs) {
  const offset = String(process.env.SIIGO_TIMEZONE_OFFSET || '-05:00');
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return new Date(epochMs).toISOString();
  const direction = match[1] === '-' ? -1 : 1;
  const offsetMs = direction * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
  return new Date(epochMs + offsetMs).toISOString().slice(0, 19);
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

  while (page <= MAX_INCREMENTAL_PAGES) {
    const response = await siigoGet('/v1/invoices', {
      // SIIGO returns and filters invoice metadata using a naive company-local
      // timestamp in this account. Keep the local cursor in UTC, but serialize
      // the remote filter with the configured company offset.
      params: { page, page_size: PAGE_SIZE, updated_start: siigoLocalTimestamp(cutoffMs) },
      entidad: 'factura_importada',
      logResponse: false,
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    if (!results.length) break;

    for (const summary of results) {
      const changedMs = parseSiigoTimestamp(
        summary?.metadata?.last_updated || summary?.metadata?.created || summary?.date || ''
      );
      if (Number.isFinite(changedMs) && changedMs < cutoffMs) continue;
      if (summary?.annulled === true || !summary?.id) continue;
      if (isSharedSandbox()) {
        const codes = (summary.items || []).map(item => String(item.code || '').toUpperCase());
        if (!codes.some(code => code.startsWith(testPrefix()))) continue;
      }
      invoices.push(await siigoGet(`/v1/invoices/${encodeURIComponent(summary.id)}`, {
        entidad: 'factura_importada',
      }));
    }

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

    if (!ids.length && !results.some(result => result.status === 'error')) {
      await setCursor(startedAt.toISOString());
    }
    const errors = results.filter(result => result.status === 'error').length;
    return res.status(errors ? 207 : 200).json({
      ok: errors === 0,
      data: {
        mode: ids.length ? 'targeted' : 'incremental',
        since: ids.length ? null : since,
        fetched: invoices.length,
        created: results.filter(result => result.status === 'created').length,
        duplicates: results.filter(result => result.status === 'duplicate').length,
        errors,
        results,
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[siigo/import-invoices]', err.message);
    return res.status(500).json({ ok: false, error: 'Error importando facturas desde SIIGO' });
  }
};
