const svc = require('./bom.service');
const catchAsync = require('../../utils/catchAsync');

exports.getByProduct = catchAsync(async (req, res) => res.json({ ok: true, data: await svc.getByProduct(req.params.product_id) }));
exports.upsert       = catchAsync(async (req, res) => res.status(201).json({ ok: true, data: await svc.upsert(req.body) }));
exports.remove       = catchAsync(async (req, res) => { await svc.remove(req.params.id); res.json({ ok: true, message: 'Línea BOM eliminada' }); });
