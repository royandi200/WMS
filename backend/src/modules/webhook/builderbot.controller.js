const svc           = require('./builderbot.service');
const { logWebhook } = require('./webhookLog.service');
const catchAsync    = require('../../utils/catchAsync');

exports.handle = catchAsync(async (req, res) => {
  const { from, info } = req.body;
  const action  = info['@ction'];
  const params  = info.params || {};
  const priority = info.priority || 'baja';

  const result = await svc.dispatch({ from, action, params, priority });

  // Log de respuesta exitosa
  await logWebhook({
    from,
    action,
    priority,
    payload:  req.body,
    response: result,
    status:   'PROCESSED'
  }).catch(() => {});

  res.json({ ok: true, ...result });
});
