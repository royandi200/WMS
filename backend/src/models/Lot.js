const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Lot = sequelize.define('Lot', {
  id:                  { type: DataTypes.CHAR(36), defaultValue: DataTypes.UUIDV4, primaryKey: true },
  lpn:                 { type: DataTypes.STRING(40), allowNull: false, unique: true },
  product_id:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  qty_initial:         { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  qty_current:         { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  supplier:            { type: DataTypes.STRING(150) },
  origin: {
    type: DataTypes.ENUM('RECEPCION','PRODUCCION','DEVOLUCION','AJUSTE'),
    defaultValue: 'RECEPCION'
  },
  status: {
    type: DataTypes.ENUM('DISPONIBLE','CUARENTENA','COMPROMETIDO','DESPACHADO','AGOTADO'),
    defaultValue: 'DISPONIBLE'
  },
  expiry_date:         { type: DataTypes.DATEONLY },
  production_order_id: { type: DataTypes.INTEGER.UNSIGNED },
  received_by:         { type: DataTypes.INTEGER.UNSIGNED },
  notes:               { type: DataTypes.TEXT }
}, {
  tableName: 'lots',
  indexes: [
    { fields: ['product_id'] },
    { fields: ['status'] },
    { fields: ['lpn'] },
    { fields: ['product_id', 'status'] },
    { fields: ['expiry_date'] }
  ]
});

module.exports = Lot;
