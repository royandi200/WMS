const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id:            { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  nombre:        { type: DataTypes.STRING(120), allowNull: false },
  email:         { type: DataTypes.STRING(120), unique: true },
  password_hash: { type: DataTypes.STRING(255) },
  rol_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  activo:        { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'usuarios',
  timestamps: false
});

module.exports = User;
