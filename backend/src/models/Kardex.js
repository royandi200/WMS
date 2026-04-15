const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Kardex = sequelize.define('Kardex', {
  id:           { type: DataTypes.CHAR(36), defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tx_id:        { type: DataTypes.STRING(40), allowNull: false, unique: true },
  lot_id:       { type: DataTypes.CHAR(36) },
  product_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  user_id:      { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  action: {
    type: DataTypes.ENUM(
      'INGRESO_RECEPCION','INGRESO_NOVEDAD',
      'CONSUMO_MATERIAL','DESPACHO',
      'MERMA_PROCESO','MERMA_BODEGA','MERMA_CIERRE_WIP',
      'DEVOLUCION','PRODUCCION_PLANEADA','CIERRE_PRODUCCION',
      'AVANCE_FASE','EXCEPCION_FIFO','AJUSTE_RETORNO',
      'SOLICITUD_RECHAZADA','AJUSTE_MANUAL','SIIGO_SYNC'
    ),
    allowNull: false
  },
  qty:          { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  balance_after:{ type: DataTypes.DECIMAL(12, 3) },
  reference:    { type: DataTypes.STRING(100) },
  notes:        { type: DataTypes.TEXT },
  approved_by:  { type: DataTypes.INTEGER.UNSIGNED }
}, {
  tableName: 'kardex',
  updatedAt: false,
  indexes: [
    { fields: ['product_id'] },
    { fields: ['lot_id'] },
    { fields: ['action'] },
    { fields: ['created_at'] }
  ]
});

module.exports = Kardex;
