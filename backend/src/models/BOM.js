const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const BOM = sequelize.define('BOM', {
  id:                 { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  producto_final_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  insumo_id:          { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  cantidad_por_unidad:{ type: DataTypes.DECIMAL(12, 4), allowNull: false },
  unidad:             { type: DataTypes.STRING(20), defaultValue: 'und' },
  notas:              { type: DataTypes.STRING(200) }
}, {
  tableName: 'bom',
  timestamps: false,
  indexes: [
    { fields: ['producto_final_id'] },
    { unique: true, fields: ['producto_final_id', 'insumo_id'] }
  ]
});

module.exports = BOM;
