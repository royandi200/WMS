// POST /api/v1/siigo/webhooks-subscribe
// Fase 6 — Suscribe topics SIIGO confirmados para esta integracion.
// Ejecutar UNA SOLA VEZ al poner en producción (o al cambiar la URL del WMS).
// Solo Admin.
//
// SIIGO: POST /v1/webhooks
// Body: { application_id, topic, url }

const { cors, requireRole } = require('../../_lib/auth');
const { siigoPost }         = require('../../_lib/siigo.service');

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

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin']);
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
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
        const resp = await siigoPost('/v1/webhooks', {
          application_id: appId,
          topic:          t.topic,
          url:            `${baseUrl}${t.path}?secret=${encodeURIComponent(secret)}`,
        }, { entidad: 'webhook-subscribe' });

        resultados.push({
          label:   t.label,
          ok:      true,
          siigo_id: resp?.id || null,
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
