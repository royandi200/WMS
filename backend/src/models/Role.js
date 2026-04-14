const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Role = sequelize.define('Role', {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:        { type: DataTypes.STRING(50), allowNull: false, unique: true },
  description: { type: DataTypes.STRING(200) },
  permissions: { type: DataTypes.JSON, defaultValue: [] }
}, { tableName: 'roles' });

module.exports = Role;
