const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WebhookLog = sequelize.define('WebhookLog', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  from_phone:  { type: DataTypes.STRING(30) },
  action:      { type: DataTypes.STRING(60), allowNull: false },
  priority:    {
    type: DataTypes.ENUM('alta','media','baja'),
    defaultValue: 'baja'
  },
  payload:     { type: DataTypes.JSON },
  response:    { type: DataTypes.JSON },
  status:      {
    type: DataTypes.ENUM('RECEIVED','PROCESSED','REJECTED','ERROR'),
    defaultValue: 'RECEIVED'
  },
  created_at:  { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'webhook_logs',
  timestamps: false
});

module.exports = WebhookLog;
