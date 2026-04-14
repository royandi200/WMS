const Joi = require('joi');

const receptionSchema = Joi.object({
  product_id:   Joi.string().uuid().required(),
  qty_total:    Joi.number().positive().required(),
  qty_damaged:  Joi.number().min(0).default(0),
  supplier:     Joi.string().max(150).optional(),
  expiry_date:  Joi.date().iso().optional().allow(null),
  notes:        Joi.string().max(500).optional()
});

module.exports = { receptionSchema };
