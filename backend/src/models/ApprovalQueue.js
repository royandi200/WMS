const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ApprovalQueue = sequelize.define('ApprovalQueue', {
  id:               { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  codigo_solicitud: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  accion:           { type: DataTypes.STRING(80), allowNull: false },
  payload:          { type: DataTypes.JSON, allowNull: false },
  solicitado_por:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  procesado_por:    { type: DataTypes.INTEGER.UNSIGNED },
  estado:           {
    type: DataTypes.ENUM('PENDIENTE','APROBADO','RECHAZADO','EXPIRADO'),
    defaultValue: 'PENDIENTE'
  },
  motivo_rechazo:   { type: DataTypes.TEXT },
  procesado_en:     { type: DataTypes.DATE },
  expira_en:        { type: DataTypes.DATE },
  creado_en:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'aprobaciones',
  timestamps: false,
  indexes: [
    { fields: ['estado'] },
    { fields: ['solicitado_por'] },
    { fields: ['codigo_solicitud'] }
  ]
});

module.exports = ApprovalQueue;
