const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Product = sequelize.define('Product', {
  id:               { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  siigo_id:         { type: DataTypes.STRING(60), unique: true },
  siigo_code:       { type: DataTypes.STRING(60), allowNull: false, unique: true },
  siigo_account_group: { type: DataTypes.INTEGER },
  nombre:           { type: DataTypes.STRING(255), allowNull: false },
  descripcion:      { type: DataTypes.TEXT },
  tipo_producto:    {
    type: DataTypes.ENUM('Product','Service','Combo','ConsumerGood','ConsumableExpense'),
    defaultValue: 'Product'
  },
  control_stock:    { type: DataTypes.BOOLEAN, defaultValue: false },
  activo:           { type: DataTypes.BOOLEAN, defaultValue: true },
  peso_kg:          { type: DataTypes.DECIMAL(10, 3) },
  volumen_m3:       { type: DataTypes.DECIMAL(10, 4) },
  requiere_lote:    { type: DataTypes.BOOLEAN, defaultValue: false },
  requiere_serial:  { type: DataTypes.BOOLEAN, defaultValue: false },
  tax_classification: {
    type: DataTypes.ENUM('Taxed','Exempt','Excluded'),
    defaultValue: 'Taxed'
  },
  tax_included:     { type: DataTypes.BOOLEAN, defaultValue: false },
  unit_code:        { type: DataTypes.STRING(10), defaultValue: '94' },
  unit_label:       { type: DataTypes.STRING(30) },
  tariff:           { type: DataTypes.STRING(10) },
  referencia:       { type: DataTypes.STRING(80) },
  barcode:          { type: DataTypes.STRING(50) },
  marca:            { type: DataTypes.STRING(50) },
  modelo:           { type: DataTypes.STRING(50) },
  precio_venta:     { type: DataTypes.DECIMAL(18, 2) },
  stock_minimo:     { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  stock_maximo:     { type: DataTypes.DECIMAL(15, 4), defaultValue: 0 },
  siigo_synced_at:  { type: DataTypes.DATE }
}, {
  tableName: 'productos',
  createdAt: 'creado_en',
  updatedAt: 'actualizado_en'
});

module.exports = Product;
