const receptionService = require('./reception.service');
const catchAsync = require('../../utils/catchAsync');

exports.receive = catchAsync(async (req, res) => {
  const result = await receptionService.receive(req.body, req.user);
  res.status(201).json({ ok: true, data: result });
});
