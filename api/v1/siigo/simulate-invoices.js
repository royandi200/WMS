// GET /api/v1/siigo/simulate-invoices?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Simula la importación de las facturas reales de SIIGO del rango, SOLO
// LECTURA: no crea despachos, no reserva stock, no escribe en SIIGO.
const { cors, requireCapability } = require('../../_lib/auth');
const { CAPABILITIES } = require('../../_lib/capabilities');
const { simulateInvoices } = require('../../_lib/siigo.invoice-simulation');

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function today() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  cors(res, 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    await requireCapability(req, CAPABILITIES.SIIGO_SYNC);
    const importStart = String(process.env.SIIGO_IMPORT_START_DATE || '2026-10-05').trim();
    const dateStart = String(req.query?.desde || importStart).trim();
    const dateEnd = String(req.query?.hasta || today()).trim();
    if (!DATE.test(dateStart) || !DATE.test(dateEnd) || dateStart > dateEnd) {
      return res.status(400).json({ ok: false, error: 'Usa fechas YYYY-MM-DD con desde <= hasta' });
    }
    const data = await simulateInvoices({ dateStart, dateEnd, importStart });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[siigo/simulate-invoices]', error.response?.data || error.message);
    return res.status(502).json({ ok: false, error: 'No fue posible consultar las facturas en SIIGO' });
  }
};
