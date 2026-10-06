// Webhooks de SIIGO desactivados (auditoría F-01, 2026-09-02).
//
// Las rutas de facturas, compras y notas crédito solo validaban el Partner-Id,
// que no es secreto, y podían crear despachos o sumar stock con un POST
// falsificado. El WMS obtiene las facturas consultando SIIGO cada 2 minutos
// (api/v1/siigo/import-invoices) y el ingreso nace de la OC, así que estas
// rutas no se usan. Para reactivarlas hace falta firma HMAC del cuerpo,
// ventana de tiempo y deduplicación por ID de evento.
const { cors } = require('./auth');

function disabledSiigoWebhook(name) {
  return async (req, res) => {
    cors(res, 'POST');
    if (req.method === 'OPTIONS') return res.status(200).end();
    return res.status(410).json({
      ok: false,
      error: `El webhook ${name} de SIIGO está desactivado. El WMS consulta SIIGO periódicamente; no se modificó inventario.`,
    });
  };
}

module.exports = { disabledSiigoWebhook };
