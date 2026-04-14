const Joi = require('joi');

const returnSchema = Joi.object({
  product_id:     Joi.string().uuid().required(),
  qty:            Joi.number().positive().required(),
  customer_origin:Joi.string().max(150).optional(),
  condition:      Joi.string().valid('RECUPERABLE','DANADO').required(),
  notes:          Joi.string().max(500).optional()
});

module.exports = { returnSchema };
