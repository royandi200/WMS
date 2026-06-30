// POST /api/v1/approvals/approve
const https = require('https');
const { query } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');

const BB_TOKEN = process.env.BUILDERBOT_API_TOKEN || '';
const BB_BOT_ID = process.env.BUILDERBOT_BOT_ID || '';

async function pushWA(phone, text) {
  return new Promise((resolve) => {
    try {
      const number = String(phone || '').replace(/[^\d]/g, '');
      if (!number) return resolve(null);
      if (!BB_TOKEN || !BB_BOT_ID) return resolve(null);

      const body = JSON.stringify({
        number,
        messages: { content: text },
      });

      const req = https.request({
        hostname: 'app.builderbot.cloud',
        path: `/api/v2/${BB_BOT_ID}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-builderbot': BB_TOKEN,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: raw.slice(0, 400) }));
      });

      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    } catch (_) {
      resolve(null);
    }
  });
}

function buildApprovalMessage(accion, payload, requestCode) {
  if (accion === 'SOLICITAR_INICIO_PRODUCCION') {
    const orderRef = payload?.codigo_orden || payload?.order_id || '';
    return [
      `✅ *Solicitud ${requestCode} APROBADA*`,
      `Tu solicitud de inicio de producción fue validada.`,
      `Cuando tengas los insumos listos, responde:`,
      orderRef ? `*confirmo materiales orden ${orderRef}*` : '',
    ].filter(Boolean).join('\n');
  }

  if (accion === 'SOLICITAR_CIERRE_PRODUCCION') {
    return [
      `✅ *Solicitud ${requestCode} APROBADA*`,
      `El cierre de producción fue aprobado.`,
      payload?.codigo_orden ? `Orden: ${payload.codigo_orden}` : '',
    ].filter(Boolean).join('\n');
  }

  if (accion === 'SOLICITAR_DESPACHO') {
    return [
      `✅ *Solicitud ${requestCode} APROBADA*`,
      `El despacho fue aprobado.`,
      payload?.lpn ? `Lote: ${payload.lpn}` : '',
      payload?.qty ? `Cantidad: ${payload.qty}` : '',
    ].filter(Boolean).join('\n');
  }

  return `✅ *Solicitud ${requestCode} APROBADA*`;
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let user;
  try {
    user = await requireRole(req, ['Admin', 'Validador']);
  } catch (e) {
    return res.status(e.status || 401).json({ ok: false, error: e.message });
  }

  const requestCode = req.body?.request_code || req.body?.codigo_solicitud || null;
  if (!requestCode) return res.status(400).json({ ok: false, error: 'request_code requerido' });

  try {
    const rows = await query(
      `SELECT id, codigo_solicitud, accion, estado, payload
       FROM aprobaciones
       WHERE codigo_solicitud = ?
       LIMIT 1`,
      [requestCode]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Solicitud no encontrada' });
    }

    if (rows[0].estado !== 'PENDIENTE') {
      return res.status(409).json({ ok: false, error: 'La solicitud ya fue procesada' });
    }

    let payload = rows[0].payload || {};
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { payload = {}; }
    }

    await query(
      `UPDATE aprobaciones
       SET estado = 'APROBADO', procesado_por = ?, procesado_en = NOW()
       WHERE codigo_solicitud = ? AND estado = 'PENDIENTE'`,
      [user.id, requestCode]
    );

    if (payload?.operario_phone) {
      const text = buildApprovalMessage(rows[0].accion, payload, requestCode);
      await pushWA(payload.operario_phone, text);
    }

    return res.status(200).json({ ok: true, data: { codigo_solicitud: requestCode, estado: 'APROBADO' } });
  } catch (err) {
    console.error('[approvals/approve]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
};
