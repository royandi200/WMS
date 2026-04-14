const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SystemLog = sequelize.define('SystemLog', {
  id:      { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type:    { type: DataTypes.STRING(50), allowNull: false },
  action:  { type: DataTypes.STRING(80) },
  payload: { type: DataTypes.JSON },
  message: { type: DataTypes.TEXT },
  status:  { type: DataTypes.INTEGER },
  phone:   { type: DataTypes.STRING(30) },
  user_id: { type: DataTypes.UUID }
}, {
  tableName: 'system_logs',
  indexes: [
    { fields: ['type'] },
    { fields: ['created_at'] }
  ]
});

module.exports = SystemLog;
