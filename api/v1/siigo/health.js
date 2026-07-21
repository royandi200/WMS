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
