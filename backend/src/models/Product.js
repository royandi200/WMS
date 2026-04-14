const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Product = sequelize.define('Product', {
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  sku:          { type: DataTypes.STRING(80), allowNull: false, unique: true },
  name:         { type: DataTypes.STRING(200), allowNull: false },
  description:  { type: DataTypes.TEXT },
  type:         {
    type: DataTypes.ENUM('MATERIA_PRIMA', 'PRODUCTO_TERMINADO', 'INSUMO', 'EMPAQUE'),
    allowNull: false
  },
  unit:         { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'und' },
  min_stock:    { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  max_stock:    { type: DataTypes.DECIMAL(12, 3), defaultValue: 0 },
  // Sincronización SIIGO
  siigo_id:     { type: DataTypes.STRING(50) },
  siigo_code:   { type: DataTypes.STRING(50) },
  siigo_sync_at:{ type: DataTypes.DATE },
  siigo_active: { type: DataTypes.BOOLEAN, defaultValue: false },
  active:       { type: DataTypes.BOOLEAN, defaultValue: true }
}, { tableName: 'products' });

module.exports = Product;
