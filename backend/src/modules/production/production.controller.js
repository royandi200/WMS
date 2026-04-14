const svc = require('./production.service');
const catchAsync = require('../../utils/catchAsync');

exports.start            = catchAsync(async (req, res) => res.status(201).json({ ok: true, data: await svc.start(req.body, req.user) }));
exports.confirmMaterials = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.confirmMaterials(req.body, req.user) }));
exports.advancePhase     = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.advancePhase(req.body, req.user) }));
exports.close            = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.close(req.body, req.user) }));
exports.list             = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.list(req.query) }));
exports.getOne           = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.getOne(req.params.id) }));
