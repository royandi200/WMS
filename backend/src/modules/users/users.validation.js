const Joi = require('joi');

const roleId = Joi.number().integer().positive();

const createUserSchema = Joi.object({
  nombre: Joi.string().min(3).max(120),
  name: Joi.string().min(3).max(120),
  telefono: Joi.string().min(7).max(30).allow(null, ''),
  phone: Joi.string().min(7).max(30).allow(null, ''),
  email: Joi.string().email().lowercase().trim().required(),
  password: Joi.string().min(8).required(),
  rol_id: roleId,
  role_id: roleId,
})
  .or('nombre', 'name')
  .or('rol_id', 'role_id');

const updateUserSchema = Joi.object({
  nombre: Joi.string().min(3).max(120),
  name: Joi.string().min(3).max(120),
  telefono: Joi.string().min(7).max(30).allow(null, ''),
  phone: Joi.string().min(7).max(30).allow(null, ''),
  email: Joi.string().email().lowercase().trim(),
  rol_id: roleId,
  role_id: roleId,
  activo: Joi.boolean(),
  active: Joi.boolean(),
}).min(1);

module.exports = { createUserSchema, updateUserSchema };
