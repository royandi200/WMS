const svc = require('./dispatch.service');
const catchAsync = require('../../utils/catchAsync');

exports.dispatch = catchAsync(async (req, res) =>
  res.json({ ok: true, data: await svc.dispatch(req.body, req.user) }));
