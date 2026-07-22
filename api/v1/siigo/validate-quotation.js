const { cors, requireRole } = require('../../_lib/auth');
const { siigoGet } = require('../../_lib/siigo.service');
const { reserveQuotation, cancelQuotation } = require('../../_lib/siigo.quotation-reservation');

const SHARED_SANDBOX_USERNAME = 'sandbox@siigoapi.com';
const DEFAULT_TEST_PREFIX = 'WMSQA260721';

function validateSandboxQuotation(quotation) {
  if (String(process.env.SIIGO_USERNAME || '').toLowerCase() !== SHARED_SANDBOX_USERNAME) return;
  const prefix = String(process.env.SIIGO_TEST_PREFIX || DEFAULT_TEST_PREFIX).trim().toUpperCase();
  const codes = (quotation?.items || []).map(item => String(item.code || '').toUpperCase());
  if (!codes.length || codes.some(code => !code.startsWith(prefix))) {
    throw Object.assign(
      new Error(`En sandbox solo se validan cotizaciones con productos ${prefix}`),
      { status: 400 }
    );
  }
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const user = await requireRole(req, ['Admin', 'Supervisor', 'Operario']);
    const quotationId = String(req.body?.quotation_id || '').trim();
    if (!quotationId) {
      return res.status(400).json({ ok: false, error: 'quotation_id es requerido' });
    }

    try {
      const quotation = await siigoGet(`/v1/quotations/${encodeURIComponent(quotationId)}`, {
        entidad: 'cotizacion_validada',
      });
      validateSandboxQuotation(quotation);
      const result = await reserveQuotation(quotation, user.id);
      return res.status(result.status === 'blocked' ? 409 : 200).json({
        ok: result.status !== 'blocked',
        data: result,
      });
    } catch (err) {
      const status = err.response?.status || err.status;
      if (status === 404) {
        const result = await cancelQuotation(
          quotationId,
          'Cotizacion eliminada en SIIGO; reserva liberada'
        );
        return res.status(200).json({ ok: true, data: result });
      }
      throw err;
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    if (err.response?.status) {
      const detail = err.response?.data?.Errors?.[0]?.Message
        || err.response?.data?.message
        || 'Error consultando la cotizacion en SIIGO';
      return res.status(err.response.status).json({ ok: false, error: detail });
    }
    console.error('[siigo/validate-quotation]', err.message);
    return res.status(500).json({ ok: false, error: 'Error validando inventario para la cotizacion' });
  }
};
