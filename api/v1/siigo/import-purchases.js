const { cors, requireRole } = require('../../_lib/auth');
const { query } = require('../../_lib/db');
const { siigoGet } = require('../../_lib/siigo.service');
const { importPurchase } = require('../../_lib/siigo.purchase-import');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';
const PAGE_SIZE = 50;

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
  const summaries = [];
  let page = 1;
  while (true) {
    const response = await siigoGet('/v1/purchases', {
      params: { updated_start: since, page, page_size: PAGE_SIZE },
      entidad: 'compra_importada',
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    summaries.push(...results);
    const total = Number(response?.pagination?.total_results ?? results.length);
    if (!results.length || summaries.length >= total) break;
    page++;
  }

  const purchases = [];
  for (const summary of summaries) {
    if (!summary?.id) continue;
    purchases.push(await siigoGet(`/v1/purchases/${encodeURIComponent(summary.id)}`, {
      entidad: 'compra_importada',
    }));
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

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const user = await requireRole(req, ['Admin', 'Supervisor']);
    const ids = requestedIds(req);
    if (isSharedSandbox() && !ids.length) {
      return res.status(400).json({
        ok: false,
        error: 'En el sandbox compartido purchase_ids es obligatorio para no consultar compras ajenas',
      });
    }

    const startedAt = new Date();
    const since = String(req.body?.updated_start || await getCursor());
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
        duplicates: results.filter(result => result.status === 'duplicate').length,
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
