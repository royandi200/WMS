const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Product = sequelize.define('Product', {
  id:               { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  siigo_code:       { type: DataTypes.STRING(60), unique: true },
  nombre:           { type: DataTypes.STRING(200), allowNull: false },
  descripcion:      { type: DataTypes.TEXT },
  tipo_producto:    {
    type: DataTypes.ENUM('Product', 'Service', 'ConsumableExpense'),
    defaultValue: 'Product'
  },
  control_stock:    { type: DataTypes.BOOLEAN, defaultValue: true },
  activo:           { type: DataTypes.BOOLEAN, defaultValue: true },
  requiere_lote:    { type: DataTypes.BOOLEAN, defaultValue: false },
  requiere_serial:  { type: DataTypes.BOOLEAN, defaultValue: false },
  unit_label:       { type: DataTypes.STRING(20), defaultValue: 'und' },
  stock_minimo:     { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  precio_venta:     { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  tax_classification: {
    type: DataTypes.ENUM('Taxed','Exempt','Excluded'),
    defaultValue: 'Taxed'
  },
  peso_kg:          { type: DataTypes.DECIMAL(10, 3), defaultValue: 0 }
}, {
  tableName: 'productos',
  timestamps: false
});

module.exports = Product;
