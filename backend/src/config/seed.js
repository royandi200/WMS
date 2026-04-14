require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize } = require('./database');
const User = require('../models/User');
const Role = require('../models/Role');
const logger = require('./logger');

async function seed() {
  await sequelize.authenticate();

  // Roles
  const roles = ['Admin', 'Validador', 'Operario', 'Consulta'];
  const permissions = {
    Admin:     ['*'],
    Validador: ['APROBAR_SOLICITUD','RECHAZAR_SOLICITUD','CONSULTAR_*','INGRESO_RECEPCION','SOLICITAR_DESPACHO','REPORTE_MERMA','SOLICITAR_CIERRE_PRODUCCION'],
    Operario:  ['INGRESO_RECEPCION','SOLICITAR_INICIO_PRODUCCION','CONFIRMAR_MATERIALES','AVANCE_FASES','SOLICITAR_CIERRE_PRODUCCION','SOLICITAR_DESPACHO','REPORTE_MERMA','EXCEPCION_PICKING','GESTION_DEVOLUCION','CONSULTAR_*'],
    Consulta:  ['CONSULTAR_*']
  };

  for (const name of roles) {
    await Role.findOrCreate({
      where: { name },
      defaults: { name, permissions: JSON.stringify(permissions[name]), description: `Rol ${name}` }
    });
  }

  // Usuario admin por defecto
  const hash = await bcrypt.hash('Admin123!', 12);
  const adminRole = await Role.findOne({ where: { name: 'Admin' } });
  await User.findOrCreate({
    where: { phone: '0000000000' },
    defaults: {
      name: 'Administrador WMS',
      phone: '0000000000',
      email: 'admin@wms.local',
      password_hash: hash,
      role_id: adminRole.id,
      active: true
    }
  });

  logger.info('✅ Seed completado — admin/Admin123!');
  process.exit(0);
}

seed().catch(err => { logger.error(err); process.exit(1); });
