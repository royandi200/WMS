const Joi = require('joi');

const startSchema = Joi.object({
  product_id:   Joi.string().uuid().required(),
  qty_planned:  Joi.number().positive().required(),
  notes:        Joi.string().max(500).optional()
});

const confirmSchema = Joi.object({
  order_id:         Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().min(1)
  ).required(),
  exception_lot_id: Joi.string().uuid().optional()
});

// order_id puede ser el PK numérico (ej: 42) o el codigo_orden (ej: "OP-20260416-0001")
const advanceSchema = Joi.object({
  order_id: Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().min(1)
  ).required(),
  phase: Joi.string().valid('F1', 'F2', 'F3', 'F4', 'F5').required()
});

const closeSchema = Joi.object({
  order_id: Joi.alternatives().try(
    Joi.number().integer().positive(),
    Joi.string().min(1)
  ).required(),
  qty_real: Joi.number().min(0).required()
});

module.exports = { startSchema, confirmSchema, advanceSchema, closeSchema };
