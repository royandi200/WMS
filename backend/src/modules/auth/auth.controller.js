const authService = require('./auth.service');
const catchAsync = require('../../utils/catchAsync');

exports.login = catchAsync(async (req, res) => {
  const result = await authService.login(req.body);
  res.json({ ok: true, ...result });
});

exports.refresh = catchAsync(async (req, res) => {
  const result = await authService.refresh(req.body.refresh_token);
  res.json({ ok: true, ...result });
});

exports.changePassword = catchAsync(async (req, res) => {
  await authService.changePassword(req.user.id, req.body);
  res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
});
