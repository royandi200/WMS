const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Stock = sequelize.define('Stock', {
  id:           { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  producto_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  bodega_id:    { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  ubicacion_id: { type: DataTypes.INTEGER.UNSIGNED },
  lote:         { type: DataTypes.STRING(60) },
  fecha_venc:   { type: DataTypes.DATEONLY },
  cantidad:     { type: DataTypes.DECIMAL(12, 4), allowNull: false, defaultValue: 0 },
  reservada:    { type: DataTypes.DECIMAL(12, 4), defaultValue: 0 }
}, {
  tableName: 'stock',
  timestamps: false,
  indexes: [
    { fields: ['producto_id'] },
    { fields: ['bodega_id'] },
    { fields: ['lote'] },
    { fields: ['fecha_venc'] },
    { unique: true, fields: ['producto_id', 'bodega_id', 'ubicacion_id', 'lote'] }
  ]
});

module.exports = Stock;
