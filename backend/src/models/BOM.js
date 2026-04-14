const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const BOM = sequelize.define('BOM', {
  id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  product_id:       { type: DataTypes.UUID, allowNull: false },
  input_product_id: { type: DataTypes.UUID, allowNull: false },
  qty_per_unit:     { type: DataTypes.DECIMAL(12, 4), allowNull: false },
  unit:             { type: DataTypes.STRING(20), defaultValue: 'und' },
  notes:            { type: DataTypes.STRING(200) }
}, {
  tableName: 'bom',
  indexes: [
    { fields: ['product_id'] },
    { unique: true, fields: ['product_id', 'input_product_id'] }
  ]
});

module.exports = BOM;
