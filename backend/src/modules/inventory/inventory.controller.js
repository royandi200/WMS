const invService = require('./inventory.service');
const catchAsync = require('../../utils/catchAsync');

exports.globalSummary = catchAsync(async (req, res) =>
  res.json({ ok: true, data: await invService.globalSummary() }));

exports.productStock = catchAsync(async (req, res) =>
  res.json({ ok: true, data: await invService.productStock(req.params.id) }));

exports.lotDetail = catchAsync(async (req, res) =>
  res.json({ ok: true, data: await invService.lotDetail(req.params.lpn) }));

exports.kardexList = catchAsync(async (req, res) =>
  res.json({ ok: true, data: await invService.kardexList(req.query) }));

exports.lowStock = catchAsync(async (req, res) =>
  res.json({ ok: true, data: await invService.lowStock() }));
