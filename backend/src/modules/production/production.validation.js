const Joi = require('joi');

const startSchema = Joi.object({
  product_id:   Joi.string().uuid().required(),
  qty_planned:  Joi.number().positive().required(),
  notes:        Joi.string().max(500).optional()
});

const confirmSchema = Joi.object({
  order_id:         Joi.string().uuid().required(),
  exception_lot_id: Joi.string().uuid().optional() // FIFO override
});

const advanceSchema = Joi.object({
  order_id:     Joi.string().uuid().required(),
  phase:        Joi.string().valid('F1','F2','F3','F4','F5').required()
});

const closeSchema = Joi.object({
  order_id:  Joi.string().uuid().required(),
  qty_real:  Joi.number().min(0).required()
});

module.exports = { startSchema, confirmSchema, advanceSchema, closeSchema };
