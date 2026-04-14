const Joi = require('joi');

const dispatchSchema = Joi.object({
  lot_id:          Joi.string().uuid().required(),
  qty:             Joi.number().positive().required(),
  customer:        Joi.string().max(150).required(),
  siigo_order_id:  Joi.string().max(80).optional(),
  notes:           Joi.string().max(500).optional()
});

module.exports = { dispatchSchema };
