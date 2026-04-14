const Joi = require('joi');

const wasteSchema = Joi.object({
  type:                Joi.string().valid('MERMA_EN_MAQUINA','MERMA_EN_ESTANTERIA','MERMA_CIERRE_WIP','RECHAZO_PROVEEDOR','VENCIMIENTO','AJUSTE_MANUAL').required(),
  product_id:          Joi.string().uuid().required(),
  qty:                 Joi.number().positive().required(),
  lot_id:              Joi.string().uuid().optional(),
  production_order_id: Joi.string().uuid().optional(),
  reason:              Joi.string().max(500).optional()
}).or('lot_id', 'production_order_id');

module.exports = { wasteSchema };
