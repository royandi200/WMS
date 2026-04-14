const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Sku = sequelize.define('Sku', {
  id:          { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  producto_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  sku:         { type: DataTypes.STRING(80), allowNull: false, unique: true },
  tipo:        {
    type: DataTypes.ENUM('PRINCIPAL','PROVEEDOR','BARCODE','ALIAS'),
    defaultValue: 'PRINCIPAL'
  },
  descripcion: { type: DataTypes.STRING(200) },
  unidad:      { type: DataTypes.STRING(20) },
  factor_conv: { type: DataTypes.DECIMAL(12, 6), defaultValue: 1.000000 },
  activo:      { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'skus',
  timestamps: false
});

module.exports = Sku;
