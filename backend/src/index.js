require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const { sequelize } = require('./config/database');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');
const rateLimiter = require('./middleware/rateLimiter');
const healthSvc = require('./modules/healthcheck/healthcheck.service');

// Routers
const authRouter = require('./modules/auth/auth.routes');
const usersRouter = require('./modules/users/users.routes');
const inventoryRouter = require('./modules/inventory/inventory.routes');
const receptionRouter = require('./modules/reception/reception.routes');
const productionRouter = require('./modules/production/production.routes');
const dispatchRouter = require('./modules/dispatch/dispatch.routes');
const wasteRouter = require('./modules/waste/waste.routes');
const returnsRouter = require('./modules/returns/returns.routes');
const approvalsRouter = require('./modules/approvals/approvals.routes');
const bomRouter = require('./modules/bom/bom.routes');
const siigoRouter = require('./modules/siigo/siigo.routes');
const webhookRouter = require('./modules/webhook/webhook.routes');

// Jobs
require('./jobs/siigo.sync.job');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Seguridad y utilidades ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: msg => logger.http(msg.trim()) } }));
app.use(rateLimiter);

// ── Rutas API ───────────────────────────────────────────────────────────
const API = '/api/v1';

// Health check — SIN auth, bajo /api/v1/health para pasar el proxy de Vercel
app.get(`${API}/health`, async (req, res) => {
  try {
    const result = await healthSvc.check();
    const code   = result.status === 'ok' ? 200 : result.status === 'degraded' ? 207 : 503;
    res.status(code).json(result);
  } catch (e) {
    res.status(503).json({ status: 'error', message: e.message });
  }
});

app.use(`${API}/auth`,       authRouter);
app.use(`${API}/users`,      usersRouter);
app.use(`${API}/inventory`,  inventoryRouter);
app.use(`${API}/reception`,  receptionRouter);
app.use(`${API}/production`, productionRouter);
app.use(`${API}/dispatch`,   dispatchRouter);
app.use(`${API}/waste`,      wasteRouter);
app.use(`${API}/returns`,    returnsRouter);
app.use(`${API}/approvals`,  approvalsRouter);
app.use(`${API}/bom`,        bomRouter);
app.use(`${API}/siigo`,      siigoRouter);
app.use(`${API}/webhook`,    webhookRouter);

// ── Error handler (siempre al final) ────────────────────────────────────────
app.use(errorHandler);

// ── Inicializar DB y levantar servidor ───────────────────────────────────────
(async () => {
  try {
    await sequelize.authenticate();
    logger.info('✅ Conexión a MySQL establecida');
    if (process.env.DB_SYNC === 'true') {
      await sequelize.sync({ alter: true });
      logger.info('✅ Modelos sincronizados con la base de datos');
    }
    app.listen(PORT, () => logger.info(`🚀 WMS API corriendo en puerto ${PORT}`));
  } catch (err) {
    logger.error('❌ Error al conectar la base de datos:', err);
    process.exit(1);
  }
})();

module.exports = app;
