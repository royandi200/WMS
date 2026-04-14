const svc = require('./returns.service');
const catchAsync = require('../../utils/catchAsync');

exports.processReturn = catchAsync(async (req, res) =>
  res.status(201).json({ ok: true, data: await svc.processReturn(req.body, req.user) }));
