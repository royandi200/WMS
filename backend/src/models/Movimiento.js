const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Movimiento = sequelize.define('Movimiento', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  tipo:            {
    type: DataTypes.ENUM('entrada','salida','traslado','ajuste','merma'),
    allowNull: false
  },
  producto_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  bodega_orig:     { type: DataTypes.INTEGER.UNSIGNED },
  bodega_dest:     { type: DataTypes.INTEGER.UNSIGNED },
  ubicacion_orig:  { type: DataTypes.INTEGER.UNSIGNED },
  ubicacion_dest:  { type: DataTypes.INTEGER.UNSIGNED },
  lote:            { type: DataTypes.STRING(60) },
  cantidad:        { type: DataTypes.DECIMAL(12, 4), allowNull: false },
  referencia_id:   { type: DataTypes.INTEGER.UNSIGNED },
  referencia_tipo: { type: DataTypes.STRING(40) },
  usuario_id:      { type: DataTypes.INTEGER.UNSIGNED },
  siigo_sync:      { type: DataTypes.BOOLEAN, defaultValue: false },
  creado_en:       { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'movimientos',
  timestamps: false,
  indexes: [
    { fields: ['producto_id'] },
    { fields: ['tipo'] },
    { fields: ['creado_en'] },
    { fields: ['referencia_id', 'referencia_tipo'] }
  ]
});

module.exports = Movimiento;
