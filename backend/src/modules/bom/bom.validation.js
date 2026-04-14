const Joi = require('joi');

const bomSchema = Joi.object({
  product_id:       Joi.string().uuid().required(),
  input_product_id: Joi.string().uuid().required(),
  qty_per_unit:     Joi.number().positive().required(),
  unit:             Joi.string().max(20).default('und'),
  notes:            Joi.string().max(200).optional()
});

module.exports = { bomSchema };
