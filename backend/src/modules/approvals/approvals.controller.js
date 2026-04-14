const svc = require('./approvals.service');
const catchAsync = require('../../utils/catchAsync');

exports.list    = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.list() }));
exports.approve = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.approve(req.body.request_code, req.user) }));
exports.reject  = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.reject(req.body, req.user) }));
