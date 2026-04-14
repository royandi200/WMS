const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const WasteRecord = sequelize.define('WasteRecord', {
  id:            { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  codigo:        { type: DataTypes.STRING(30), allowNull: false, unique: true },
  tipo:          {
    type: DataTypes.ENUM(
      'MERMA_EN_MAQUINA','MERMA_EN_ESTANTERIA','MERMA_CIERRE_WIP',
      'RECHAZO_PROVEEDOR','VENCIMIENTO','AJUSTE_MANUAL'
    ),
    allowNull: false
  },
  producto_id:   { type: DataTypes.INTEGER.UNSIGNED },
  lote:          { type: DataTypes.STRING(60) },
  orden_id:      { type: DataTypes.INTEGER.UNSIGNED },
  cantidad:      { type: DataTypes.DECIMAL(12, 3), allowNull: false },
  motivo:        { type: DataTypes.TEXT },
  reportado_por: { type: DataTypes.INTEGER.UNSIGNED },
  aprobado_por:  { type: DataTypes.INTEGER.UNSIGNED },
  estado:        {
    type: DataTypes.ENUM('PENDIENTE','APROBADO','RECHAZADO'),
    defaultValue: 'PENDIENTE'
  },
  creado_en:     { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'mermas',
  timestamps: false
});

module.exports = WasteRecord;
