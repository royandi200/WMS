const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WasteRecord = sequelize.define('WasteRecord', {
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  waste_code:    { type: DataTypes.STRING(30), allowNull: false, unique: true },
  type:          {
    type: DataTypes.ENUM(
      'MERMA_EN_MAQUINA','MERMA_EN_ESTANTERIA','MERMA_CIERRE_WIP',
      'RECHAZO_PROVEEDOR','VENCIMIENTO','AJUSTE_MANUAL'
    ),
    allowNull: false
  },
  product_id:    { type: DataTypes.UUID },
  lot_id:        { type: DataTypes.UUID },
  production_order_id: { type: DataTypes.UUID },
  qty:           { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  reason:        { type: DataTypes.TEXT },
  reported_by:   { type: DataTypes.UUID },
  approved_by:   { type: DataTypes.UUID },
  status:        {
    type: DataTypes.ENUM('PENDIENTE','APROBADO','RECHAZADO'),
    defaultValue: 'PENDIENTE'
  }
}, { tableName: 'waste_records' });

module.exports = WasteRecord;
