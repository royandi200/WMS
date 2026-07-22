// POST /api/v1/siigo/webhooks-subscribe
// Fase 6 — Suscribe topics SIIGO confirmados para esta integracion.
// Ejecutar UNA SOLA VEZ al poner en producción (o al cambiar la URL del WMS).
// Solo Admin.
//
// SIIGO: POST /v1/webhooks
// Body: { application_id, topic, url }

const { cors, requireRole } = require('../../_lib/auth');
const { siigoPost, siigoPut } = require('../../_lib/siigo.service');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';

const TOPICS = [
  {
    topic: 'public.siigoapi.products.create',
    path:  '/api/v1/webhook/siigo-products',
    label: 'products.create',
  },
];

function getPublicBaseUrl() {
  const raw = process.env.WMS_PUBLIC_URL || process.env.FRONTEND_URL?.replace('/app', '');
  if (!raw) throw Object.assign(new Error('WMS_PUBLIC_URL no configurada'), { status: 500 });
  const url = new URL(raw);
  if (url.protocol !== 'https:') {
    throw Object.assign(new Error('WMS_PUBLIC_URL debe usar HTTPS'), { status: 500 });
  }
  return url.toString().replace(/\/$/, '');
}

function getSiigoErrorCodes(err) {
  const errors = err.response?.data?.errors || err.response?.data?.Errors || [];
  return errors.map(item => String(item?.code || item?.Code || '').toLowerCase());
}

function isWebhookMissingError(err) {
  if (err.response?.status === 404) return true;
  const codes = getSiigoErrorCodes(err);
  return codes.some(code => ['not_found', 'does_not_exist'].includes(code));
}

async function upsertWebhook(payload) {
  try {
    return {
      action: 'updated',
      response: await siigoPut('/v1/webhooks', payload, { entidad: 'webhook-subscribe' }),
    };
  } catch (err) {
    if (!isWebhookMissingError(err)) throw err;
    return {
      action: 'created',
      response: await siigoPost('/v1/webhooks', payload, { entidad: 'webhook-subscribe' }),
    };
  }
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin']);
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const isSharedSandbox = String(process.env.SIIGO_USERNAME || '').trim().toLowerCase() ===
      SHARED_SANDBOX_USERNAME;
    if (isSharedSandbox && process.env.SIIGO_ALLOW_SHARED_SANDBOX_WEBHOOK_UPDATE !== 'true') {
      return res.status(409).json({
        ok: false,
        error: 'No se modifican webhooks de la cuenta sandbox compartida de SIIGO',
        data: { shared_sandbox: true, receptor_listo: true },
      });
    }

    const baseUrl    = getPublicBaseUrl();
    const secret     = process.env.SIIGO_WEBHOOK_SECRET;
    if (!secret || secret.length < 24) {
      return res.status(500).json({ ok: false, error: 'SIIGO_WEBHOOK_SECRET no configurado o muy corto' });
    }
    const appId      = process.env.SIIGO_WEBHOOK_APPLICATION_ID ||
                       process.env.SIIGO_TEST_PREFIX ||
                       'WMSQASandbox';
    const resultados = [];

    for (const t of TOPICS) {
      try {
        const payload = {
          application_id: appId,
          topic:          t.topic,
          url:            `${baseUrl}${t.path}?secret=${encodeURIComponent(secret)}`,
        };
        const { action, response } = await upsertWebhook(payload);

        resultados.push({
          label:   t.label,
          ok:      true,
          action,
          siigo_id: response?.id || null,
          url:     `${baseUrl}${t.path}`,
        });
      } catch (err) {
        resultados.push({
          label: t.label,
          ok:    false,
          error: err.response?.data || err.message,
        });
      }
    }

    const exitosos = resultados.filter(r => r.ok).length;
    return res.status(200).json({
      ok:   exitosos > 0,
      data: { exitosos, total: TOPICS.length, resultados },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[webhooks-subscribe]', err.message);
    return res.status(500).json({ ok: false, error: 'Error al suscribir webhooks' });
  }
};
