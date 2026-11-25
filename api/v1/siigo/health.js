// GET /api/v1/siigo/health
// Fase 1 — Verifica que la integración SIIGO esté correctamente configurada:
//   1. Obtiene (o refresca) el Bearer token
//   2. Llama a /v1/document-types (endpoint liviano) para confirmar
//      que el token autentica correctamente contra SIIGO
// Solo accesible para Admin y Supervisor.

const { cors, requireRole } = require('../../_lib/auth');
const { getValidToken, siigoGet } = require('../../_lib/siigo.service');

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin', 'Supervisor']);

    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const startedAt = Date.now();

    if (req.query?.ai === 'true') {
      const configured = Boolean(process.env.GROQ_API_KEY);
      let status = null;
      let detail = null;
      if (configured) {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: 'Responde el objeto JSON {"ok":true}' }],
          }),
        });
        status = response.status;
        if (!response.ok) detail = (await response.text()).slice(0, 300);
      }
      let models = [];
      if (configured) {
        const listed = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        });
        if (listed.ok) models = ((await listed.json()).data || []).map(model => model.id);
      }
      return res.status(200).json({ ok: true, data: { groq_configured: configured, groq_status: status, detalle: detail, modelos: models } });
    }

    if (req.query?.warehouses === 'true') {
      const warehouses = await siigoGet('/v1/warehouses', { entidad: 'health-check' });
      const list = Array.isArray(warehouses) ? warehouses : (warehouses?.results || []);
      return res.status(200).json({
        ok: true,
        data: list.map(w => ({ id: w.id, name: w.name, active: w.active, has_movements: w.has_movements })),
      });
    }

    // Solo lectura: muestra que cantidad reporta SIIGO para unos productos (?stock=COD1,COD2).
    if (req.query?.stock) {
      const codes = String(req.query.stock).split(',').map(c => c.trim()).filter(Boolean).slice(0, 5);
      const data = [];
      for (const code of codes) {
        const found = await siigoGet('/v1/products', { params: { code }, entidad: 'health-check' });
        const product = (Array.isArray(found) ? found : (found?.results || []))[0];
        data.push(product ? {
          code: product.code,
          name: product.name,
          stock_control: product.stock_control,
          available_quantity: product.available_quantity,
          warehouses: product.warehouses,
          campos: Object.keys(product),
        } : { code, encontrado: false });
      }
      return res.status(200).json({ ok: true, data });
    }

    // 1. Verificar / obtener token
    const token = await getValidToken();

    // 2. Llamada de prueba a SIIGO — /v1/document-types es liviano y no modifica datos
    const docTypes = await siigoGet('/v1/document-types', {
      params: { type: 'FV' },
      entidad: 'health-check',
    });

    const count = Array.isArray(docTypes)
      ? docTypes.length
      : (docTypes?.results?.length ?? null);

    return res.status(200).json({
      ok: true,
      data: {
        mensaje:              'Conexión con SIIGO exitosa ✅',
        token_presente:       Boolean(token),
        document_type:        'FV',
        document_types_count: count,
        latencia_ms:          Date.now() - startedAt,
        siigo_base_url:       process.env.SIIGO_BASE_URL || 'https://api.siigo.com',
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    console.error('[siigo/health]', err.response?.data || err.message);
    return res.status(502).json({
      ok:      false,
      error:   'No se pudo conectar con SIIGO',
      detalle: err.response?.data || err.message,
    });
  }
};
