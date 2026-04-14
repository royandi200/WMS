const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Tercero = sequelize.define('Tercero', {
  id:                      { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  tipo:                    {
    type: DataTypes.ENUM('Customer','Supplier','CustomerSupplier'),
    allowNull: false
  },
  person_type:             { type: DataTypes.ENUM('person','company'), allowNull: false },
  id_type:                 { type: DataTypes.STRING(5) },
  identification:          { type: DataTypes.STRING(30), allowNull: false },
  nombre:                  { type: DataTypes.STRING(200), allowNull: false },
  nombre_comercial:        { type: DataTypes.STRING(200) },
  telefono:                { type: DataTypes.STRING(20) },
  email_contacto:          { type: DataTypes.STRING(120) },
  activo:                  { type: DataTypes.BOOLEAN, defaultValue: true },
  vat_responsible:         { type: DataTypes.BOOLEAN, defaultValue: false },
  responsabilidad_fiscal:  { type: DataTypes.STRING(20) },
  creado_en:               { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'terceros',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['identification'] },
    { fields: ['tipo'] }
  ]
});

module.exports = Tercero;
