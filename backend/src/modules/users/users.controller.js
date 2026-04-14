const usersService = require('./users.service');
const catchAsync = require('../../utils/catchAsync');

exports.list    = catchAsync(async (req, res) => res.json({ ok: true, data: await usersService.list() }));
exports.create  = catchAsync(async (req, res) => res.status(201).json({ ok: true, data: await usersService.create(req.body) }));
exports.getOne  = catchAsync(async (req, res) => res.json({ ok: true, data: await usersService.getOne(req.params.id) }));
exports.update  = catchAsync(async (req, res) => res.json({ ok: true, data: await usersService.update(req.params.id, req.body) }));
exports.remove  = catchAsync(async (req, res) => { await usersService.remove(req.params.id); res.json({ ok: true, message: 'Usuario eliminado' }); });
