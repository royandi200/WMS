const svc = require('./waste.service');
const catchAsync = require('../../utils/catchAsync');

exports.report = catchAsync(async (req, res) => res.status(201).json({ ok: true, data: await svc.report(req.body, req.user) }));
exports.list   = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.list(req.query) }));
