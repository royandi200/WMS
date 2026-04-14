const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Ubicacion = sequelize.define('Ubicacion', {
  id:        { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  bodega_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  codigo:    { type: DataTypes.STRING(30), allowNull: false, unique: true },
  zona:      { type: DataTypes.STRING(10) },
  pasillo:   { type: DataTypes.STRING(10) },
  nivel:     { type: DataTypes.STRING(10) },
  activa:    { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
  tableName: 'ubicaciones',
  timestamps: false
});

module.exports = Ubicacion;
