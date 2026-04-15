const svc            = require('./builderbot.service');
const { logWebhook } = require('./webhookLog.service');
const catchAsync     = require('../../utils/catchAsync');

// ─── Extrae el primer JSON válido que contenga una acción (@ction / acti@n / action) ───
// Lógica idéntica a bardj-ai/api/webhook.js → extractActionJSON()
function extractActionJSON(raw) {
  if (typeof raw !== 'string') return null;
  const matches = [];
  let depth = 0, start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) { matches.push(raw.slice(start, i + 1)); start = -1; }
    }
  }
  for (const block of matches) {
    try {
      const parsed = JSON.parse(block);
      const hasAction = parsed['@ction'] || parsed['acti@n'] || parsed.action;
      if (hasAction) {
        // Normalizar todas las variantes a '@ction'
        if (parsed['acti@n']) { parsed['@ction'] = parsed['acti@n']; delete parsed['acti@n']; }
        if (parsed.action)    { parsed['@ction'] = parsed.action;    delete parsed.action; }
        return parsed;
      }
    } catch { /* sigue */ }
  }
  return null;
}

// ─── Intenta extraer el payload desde cualquier campo del body ───
function extractPayload(rawBody) {
  let payload = null;

  // Caso 1: body.body es string con JSON embebido (más común en BuilderBot)
  if (typeof rawBody?.body === 'string')
    payload = extractActionJSON(rawBody.body);

  // Caso 2: body.info es string JSON
  if (!payload && typeof rawBody?.info === 'string')
    payload = extractActionJSON(rawBody.info);

  // Caso 3: body.info ya es objeto (caso feliz BuilderBot v3+)
  if (!payload && rawBody?.info && typeof rawBody.info === 'object') {
    const info   = rawBody.info;
    const action = info['@ction'] || info['acti@n'] || info.action;
    if (action) {
      payload = { ...info, '@ction': action };
      delete payload['acti@n'];
      delete payload.action;
    }
  }

  // Caso 4: la acción está en el root del body
  if (!payload && (rawBody?.['@ction'] || rawBody?.['acti@n'] || rawBody?.action))
    payload = extractActionJSON(JSON.stringify(rawBody));

  // Caso 5: el body completo es un string JSON
  if (!payload && typeof rawBody === 'string')
    payload = extractActionJSON(rawBody);

  return payload;
}

exports.handle = catchAsync(async (req, res) => {
  const rawBody = req.body;
  const payload = extractPayload(rawBody);

  // Sin payload válido → respuesta controlada igual que bardj-ai
  if (!payload) {
    await logWebhook({
      from:     rawBody?.from,
      action:   'PARSE_ERROR',
      priority: 'baja',
      payload:  rawBody,
      response: { error: 'No se encontró @ction en el mensaje' },
      status:   'REJECTED'
    }).catch(() => {});
    return res.status(400).json({
      ok: false, action: null, mensaje: null, data: null,
      error: 'No se encontró acción válida en el mensaje'
    });
  }

  const from     = payload.from     || rawBody?.from;
  const action   = payload['@ction'];
  const params   = payload.params   || {};
  const priority = payload.priority || 'baja';

  const result = await svc.dispatch({ from, action, params, priority });

  await logWebhook({
    from, action, priority,
    payload:  rawBody,
    response: result,
    status:   'PROCESSED'
  }).catch(() => {});

  // Shape unificado igual que bardj-ai: { ok, action, mensaje, data, error }
  res.json({
    ok:      true,
    action,
    mensaje: result.message || null,
    data:    result.data    || null,
    error:   null
  });
});
