const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Recepcion = sequelize.define('Recepcion', {
  id:                { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  numero:            { type: DataTypes.STRING(30), allowNull: false, unique: true },
  tercero_id:        { type: DataTypes.INTEGER.UNSIGNED },
  proveedor_nombre:  { type: DataTypes.STRING(200) },
  bodega_id:         { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  estado:            {
    type: DataTypes.ENUM('borrador','en_proceso','completada','anulada'),
    defaultValue: 'borrador'
  },
  usuario_id:        { type: DataTypes.INTEGER.UNSIGNED },
  observaciones:     { type: DataTypes.TEXT },
  moneda:            { type: DataTypes.STRING(3), defaultValue: 'COP' },
  costo_total:       { type: DataTypes.DECIMAL(18, 2) },
  creado_en:         { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  completado_en:     { type: DataTypes.DATE }
}, {
  tableName: 'recepciones',
  timestamps: false
});

const RecepcionItem = sequelize.define('RecepcionItem', {
  id:             { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  recepcion_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  producto_id:    { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  ubicacion_id:   { type: DataTypes.INTEGER.UNSIGNED },
  lote:           { type: DataTypes.STRING(60) },
  fecha_venc:     { type: DataTypes.DATEONLY },
  cantidad_esp:   { type: DataTypes.DECIMAL(12, 4), allowNull: false },
  cantidad_rec:   { type: DataTypes.DECIMAL(12, 4), defaultValue: 0 },
  precio_unitario:{ type: DataTypes.DECIMAL(15, 6), defaultValue: 0 },
  descuento:      { type: DataTypes.DECIMAL(5, 2), defaultValue: 0 }
}, {
  tableName: 'recepcion_items',
  timestamps: false
});

module.exports = { Recepcion, RecepcionItem };
