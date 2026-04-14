const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Despacho = sequelize.define('Despacho', {
  id:               { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  numero:           { type: DataTypes.STRING(30), allowNull: false, unique: true },
  tercero_id:       { type: DataTypes.INTEGER.UNSIGNED },
  cliente_nombre:   { type: DataTypes.STRING(200) },
  bodega_id:        { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  estado:           {
    type: DataTypes.ENUM('borrador','picking','empaque','despachado','anulado'),
    defaultValue: 'borrador'
  },
  usuario_id:       { type: DataTypes.INTEGER.UNSIGNED },
  observaciones:    { type: DataTypes.TEXT },
  moneda:           { type: DataTypes.STRING(3), defaultValue: 'COP' },
  total_factura:    { type: DataTypes.DECIMAL(18, 2) },
  creado_en:        { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  despachado_en:    { type: DataTypes.DATE }
}, {
  tableName: 'despachos',
  timestamps: false
});

const DespachoItem = sequelize.define('DespachoItem', {
  id:              { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  despacho_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  producto_id:     { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  ubicacion_id:    { type: DataTypes.INTEGER.UNSIGNED },
  lote:            { type: DataTypes.STRING(60) },
  cantidad_sol:    { type: DataTypes.DECIMAL(12, 4), allowNull: false },
  cantidad_des:    { type: DataTypes.DECIMAL(12, 4), defaultValue: 0 },
  precio_unitario: { type: DataTypes.DECIMAL(15, 6), defaultValue: 0 },
  descuento:       { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 }
}, {
  tableName: 'despacho_items',
  timestamps: false
});

module.exports = { Despacho, DespachoItem };
