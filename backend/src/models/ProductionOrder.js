const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ProductionOrder = sequelize.define('ProductionOrder', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  codigo_orden:    { type: DataTypes.STRING(30), allowNull: false, unique: true },
  producto_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  fase:            {
    type: DataTypes.ENUM('F0','F1','F2','F3','F4','F5'),
    defaultValue: 'F0'
  },
  estado:          {
    type: DataTypes.ENUM('PLANEADA','EN_PROCESO','CERRADA','CANCELADA'),
    defaultValue: 'PLANEADA'
  },
  cantidad_planeada: { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  cantidad_real:     { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  materiales_conf_en: { type: DataTypes.DATE },
  cerrado_en:        { type: DataTypes.DATE },
  creado_por:        { type: DataTypes.INTEGER.UNSIGNED },
  aprobado_por:      { type: DataTypes.INTEGER.UNSIGNED },
  notas:             { type: DataTypes.TEXT },
  creado_en:         { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'ordenes_produccion',
  timestamps: false,
  indexes: [
    { fields: ['estado'] },
    { fields: ['producto_id'] },
    { fields: ['codigo_orden'] }
  ]
});

module.exports = ProductionOrder;
