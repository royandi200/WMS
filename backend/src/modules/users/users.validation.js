const Joi = require('joi');

const createUserSchema = Joi.object({
  name:     Joi.string().min(3).max(120).required(),
  phone:    Joi.string().min(7).max(20).required(),
  email:    Joi.string().email().optional(),
  password: Joi.string().min(8).required(),
  role_id:  Joi.string().uuid().required()
});

const updateUserSchema = Joi.object({
  name:    Joi.string().min(3).max(120),
  email:   Joi.string().email(),
  role_id: Joi.string().uuid(),
  active:  Joi.boolean()
}).min(1);

module.exports = { createUserSchema, updateUserSchema };
