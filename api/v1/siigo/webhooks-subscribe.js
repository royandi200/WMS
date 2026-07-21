// POST /api/v1/siigo/webhooks-subscribe
// Fase 6 — Suscribe los 4 topics de SIIGO en un solo disparo.
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
  {
    topic: 'public.siigoapi.products.update',
    path:  '/api/v1/webhook/siigo-products',
    label: 'products.update',
  },
  {
    topic: 'public.siigoapi.invoices.create',
    path:  '/api/v1/webhook/siigo-invoices',
    label: 'invoices.create',
  },
  {
    topic: 'public.siigoapi.invoices.void',
    path:  '/api/v1/webhook/siigo-invoices',
    label: 'invoices.void',
  },
  {
    topic: 'public.siigoapi.purchases.create',
    path:  '/api/v1/webhook/siigo-purchases',
    label: 'purchases.create',
  },
  {
    topic: 'public.siigoapi.credit-notes.create',
    path:  '/api/v1/webhook/siigo-credit-notes',
    label: 'credit-notes.create',
  },
];

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin']);
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const baseUrl    = process.env.FRONTEND_URL?.replace('/app', '') ||
                       process.env.WMS_PUBLIC_URL ||
                       'https://tu-wms.com';
    const appId      = process.env.SIIGO_PARTNER_ID || 'wms-integration';
    const resultados = [];

    for (const t of TOPICS) {
      try {
        const resp = await siigoPost('/v1/webhooks', {
          application_id: appId,
          topic:          t.topic,
          url:            `${baseUrl}${t.path}`,
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
