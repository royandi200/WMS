const Joi = require('joi');

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().trim().required(),
  password: Joi.string().min(6).required()
});

const refreshSchema = Joi.object({
  refresh_token: Joi.string().required()
});

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password:     Joi.string().min(8).required()
});

module.exports = { loginSchema, refreshSchema, changePasswordSchema };
