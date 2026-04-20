const svc = require('./approvals.service');
const catchAsync = require('../../utils/catchAsync');

exports.list = catchAsync(async (req, res) => {
  const data = await svc.list({
    estado: req.query.estado,
    limit: req.query.limit,
  });

  res.json({ ok: true, data: { rows: data, total: data.length } });
});

exports.approve = catchAsync(async (req, res) => {
  res.json({ ok: true, data: await svc.approve(req.body.request_code, req.user) });
});

exports.reject = catchAsync(async (req, res) => {
  res.json({
    ok: true,
    data: await svc.reject({
      codigo_solicitud: req.body.request_code,
      motivo: req.body.reason,
    }, req.user),
  });
});
