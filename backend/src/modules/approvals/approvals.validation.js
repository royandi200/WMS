const Joi = require('joi');

const approveSchema = Joi.object({
  request_code: Joi.string().required()
});

const rejectSchema = Joi.object({
  request_code: Joi.string().required(),
  reason:       Joi.string().max(500).optional()
});

module.exports = { approveSchema, rejectSchema };
