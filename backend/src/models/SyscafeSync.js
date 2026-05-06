const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Registro de sincronización con SysCafé.
 * Evita que un despacho se envíe más de una vez.
 */
const SyscafeSync = sequelize.define('SyscafeSync', {
  id:           { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  despacho_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  numero:       { type: DataTypes.STRING(30), allowNull: false },
  status:       {
    type: DataTypes.ENUM('pendiente', 'enviado', 'error'),
    defaultValue: 'pendiente'
  },
  intentos:     { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  respuesta:    { type: DataTypes.TEXT },
  enviado_en:   { type: DataTypes.DATE }
}, {
  tableName:  'syscafe_sync_log',
  timestamps: true,
  createdAt:  'creado_en',
  updatedAt:  'actualizado_en'
});

module.exports = SyscafeSync;
