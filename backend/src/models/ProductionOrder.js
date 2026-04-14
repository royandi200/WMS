const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ProductionOrder = sequelize.define('ProductionOrder', {
  id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  order_code:     { type: DataTypes.STRING(30), allowNull: false, unique: true },
  product_id:     { type: DataTypes.UUID, allowNull: false },
  phase:          {
    type: DataTypes.ENUM('F0','F1','F2','F3','F4','F5'),
    defaultValue: 'F0'
  },
  status:         {
    type: DataTypes.ENUM('PLANEADA','EN_PROCESO','CERRADA','CANCELADA'),
    defaultValue: 'PLANEADA'
  },
  qty_planned:    { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  qty_real:       { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  materials_confirmed_at: { type: DataTypes.DATE },
  closed_at:      { type: DataTypes.DATE },
  created_by:     { type: DataTypes.UUID },
  approved_by:    { type: DataTypes.UUID },
  notes:          { type: DataTypes.TEXT }
}, {
  tableName: 'production_orders',
  indexes: [
    { fields: ['status'] },
    { fields: ['product_id'] },
    { fields: ['order_code'] }
  ]
});

module.exports = ProductionOrder;
