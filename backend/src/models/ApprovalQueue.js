const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ApprovalQueue = sequelize.define('ApprovalQueue', {
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  request_code:  { type: DataTypes.STRING(30), allowNull: false, unique: true },
  action:        { type: DataTypes.STRING(80), allowNull: false },
  payload:       { type: DataTypes.JSON, allowNull: false },
  requested_by:  { type: DataTypes.UUID, allowNull: false },
  processed_by:  { type: DataTypes.UUID },
  status:        {
    type: DataTypes.ENUM('PENDIENTE','APROBADO','RECHAZADO','EXPIRADO'),
    defaultValue: 'PENDIENTE'
  },
  reject_reason: { type: DataTypes.TEXT },
  processed_at:  { type: DataTypes.DATE },
  expires_at:    { type: DataTypes.DATE }
}, {
  tableName: 'approval_queue',
  indexes: [
    { fields: ['status'] },
    { fields: ['requested_by'] },
    { fields: ['request_code'] }
  ]
});

module.exports = ApprovalQueue;
