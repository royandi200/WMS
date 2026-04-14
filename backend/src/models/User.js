const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:          { type: DataTypes.STRING(120), allowNull: false },
  phone:         { type: DataTypes.STRING(20), allowNull: false, unique: true },
  email:         { type: DataTypes.STRING(120), unique: true },
  password_hash: { type: DataTypes.STRING(255) },
  role_id:       { type: DataTypes.UUID, allowNull: false },
  active:        { type: DataTypes.BOOLEAN, defaultValue: true },
  last_login:    { type: DataTypes.DATE }
}, { tableName: 'users' });

module.exports = User;
