const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Bodega = sequelize.define('Bodega', {
  id:        { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  codigo:    { type: DataTypes.STRING(20), allowNull: false, unique: true },
  nombre:    { type: DataTypes.STRING(100), allowNull: false },
  direccion: { type: DataTypes.STRING(200) },
  activa:    { type: DataTypes.BOOLEAN, defaultValue: true },
  siigo_id:  { type: DataTypes.INTEGER.UNSIGNED }
}, {
  tableName: 'bodegas',
  timestamps: false
});

module.exports = Bodega;
