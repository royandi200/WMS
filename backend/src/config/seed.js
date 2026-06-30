require('dotenv').config();
const bcrypt = require('bcryptjs');
const { sequelize } = require('./database');
const User = require('../models/User');
const Role = require('../models/Role');
const logger = require('./logger');

async function seed() {
  await sequelize.authenticate();

  for (const nombre of ['Admin', 'Validador', 'Supervisor', 'Operario', 'Consulta']) {
    await Role.findOrCreate({
      where: { nombre },
      defaults: { nombre },
    });
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    logger.warn('Seed admin omitido: define SEED_ADMIN_PASSWORD para crear el usuario inicial.');
    process.exit(0);
  }

  const adminRole = await Role.findOne({ where: { nombre: 'Admin' } });
  const hash = await bcrypt.hash(adminPassword, 12);
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@wms.local';
  const telefono = process.env.SEED_ADMIN_PHONE || null;

  await User.findOrCreate({
    where: { email },
    defaults: {
      nombre: 'Administrador WMS',
      telefono,
      email,
      password_hash: hash,
      rol_id: adminRole.id,
      activo: true,
    },
  });

  logger.info(`Seed completado. Admin inicial: ${email}`);
  process.exit(0);
}

seed().catch((err) => {
  logger.error(err);
  process.exit(1);
});
