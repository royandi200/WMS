require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const { sequelize } = require('./config/database');
const logger     = require('./utils/logger');

// ── Rutas ────────────────────────────────────────────────
const authRoutes       = require('./routes/auth.routes');
const productosRoutes  = require('./routes/productos.routes');
const bodegasRoutes    = require('./routes/bodegas.routes');
const recepcionRoutes  = require('./routes/recepciones.routes');
const despachoRoutes   = require('./routes/despachos.routes');
const stockRoutes      = require('./routes/stock.routes');
const siigoRoutes      = require('./routes/siigo.routes');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middlewares ──────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// ── Health check ─────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ── API Routes ───────────────────────────────────────────
const v1 = express.Router();
v1.use('/auth',        authRoutes);
v1.use('/productos',   productosRoutes);
v1.use('/bodegas',     bodegasRoutes);
v1.use('/recepciones', recepcionRoutes);
v1.use('/despachos',   despachoRoutes);
v1.use('/stock',       stockRoutes);
v1.use('/siigo',       siigoRoutes);
app.use('/api/v1', v1);

// ── Error handler ─────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error(err.message, { stack: err.stack });
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

// ── Arranque ──────────────────────────────────────────────
async function start() {
  try {
    await sequelize.authenticate();
    logger.info('✅  Conexión a MySQL establecida correctamente');
    app.listen(PORT, () => logger.info(`🚀  WMS Backend corriendo en el puerto ${PORT}`));
  } catch (err) {
    logger.error('❌  No se pudo conectar a la base de datos:', err);
    process.exit(1);
  }
}

start();
