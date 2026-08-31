// =============================================================
// api/v1/webhook/builderbot.js — ÚNICO stack WMS × WhatsApp
// POST /api/v1/webhook/builderbot
// =============================================================
// Flujo BB Cloud:
//   BB Cloud → POST { info: "{aiResponse}", from: "{from}" }
//   Vercel procesa → responde 200 { ok:true, message:"...", mensaje:"..." }
//   BB Cloud lee {message} del HTTP response.
//   Se devuelven AMBOS campos para máxima compatibilidad.
// =============================================================
// Schema ordenes_produccion:
//   estado ENUM('PLANEADA','APROBADA','EN_PROCESO','CERRADA','CANCELADA')
// =============================================================
// Fixes aplicados:
//   [1]  SOLICITAR_DESPACHO         → id_item obligatorio
//   [2]  REPORTE_MERMA              → id_orden en notes kardex
//   [3]  EXCEPCION_PICKING          → lote_sugerido+lote_usado en system_logs
//   [4]  CONSULTAR_STOCK_*          → filtra tipo_producto MP/PT
//   [5]  GESTION_DEVOLUCION         → normaliza estado ENUM
//   [6]  CONSULTAR_STOCK_*          → v_stock_disponible, desglose FIFO
//   [7]  BOM query                  → insumo_id y producto_final_id correctos
//   [8]  roundQty()                 → corrige floating point en BOM
//   [9]  FLUJO PRODUCCIÓN 3 PASOS:
//        SOLICITAR_INICIO → verifica FIFO, encola, push WA supervisor
//        APROBAR          → reserva stock, push WA operario
//        CONFIRMAR        → descuenta stock + kardex CONSUMO_PRODUCCION
//  [10]  AVANCE_FASES               → ahora actualiza columna `fase` + appends notas
//  [11]  SOLICITAR_CIERRE_PRODUCCION → valida estado EN_PROCESO antes de cerrar;
//                                      cantReal con Number() para evitar '0' falsy;
//                                      guarda codigo_orden en payload para WA
//  [12]  AVANCE_FASES               → valida estado EN_PROCESO; logSystemEvent;
//                                      mensaje incluye codigo_orden
//  [13]  pushWA                     → corrige hostname, path, header y body según
//                                      API real de BuilderBot Cloud v2:
//                                      hostname: app.builderbot.cloud
//                                      path: /api/v2/{BOT_ID}/messages
//                                      header: x-api-builderbot
//                                      body: { number, messages: { content } }
//  [14]  getSupervisorPhone         → excluye usuarios bot (@wa.bot) para que nunca
//                                      se elija un bot como supervisor;
//                                      prioriza rol Supervisor sobre Admin;
//        pushWA                     → sanitiza número: elimina +, espacios y guiones
//                                      antes de enviar a BB Cloud
//  [15]  LOGGING DETALLADO:
//        getSupervisorPhone → loguea todos los candidatos encontrados en BD y el
//                             teléfono final seleccionado (o null si no hay ninguno)
//        pushWA             → loguea número sanitizado, URL destino, body enviado
//                             y respuesta completa de BB Cloud (status + body)
//        Flujos de solicitud → loguea supPhone antes del if para ver si es null
//  [16]  pushWA ASYNC:
//        Convertida a async con Promise — ya no es fire-and-forget.
//        Todos los pushWA en handlers usan await para que Vercel espere
//        la respuesta de BB Cloud antes de cerrar la función.
//        Esto corrige el bug donde Vercel mataba el proceso antes de que
//        la petición HTTP a BB Cloud terminara.
//  [17]  INTERCEPTOR LENGUAJE NATURAL:
//        parsearAprobacionNatural() detecta antes del switch si el texto
//        libre del mensaje contiene intención de aprobar/rechazar con un
//        código REQ-XXXXXX, y reencamina action/params automáticamente.
//        Patrones: apruebo, aprobar, autorizo, sí/si apruebo, ok apruebo,
//        rechazo, rechazar, no apruebo, denegar + REQ-XXXXXX (case-insensitive).
//        Mensaje WA al supervisor simplificado:
//        "Responde *apruebo REQ-xxx* o *rechazo REQ-xxx*"
//        en los tres flujos: SOLICITAR_INICIO_PRODUCCION,
//        SOLICITAR_CIERRE_PRODUCCION y SOLICITAR_DESPACHO.
//  [18]  MENSAJE POST-APROBACIÓN AL OPERARIO (lenguaje natural):
//        En executeApprovedPayload → SOLICITAR_INICIO_PRODUCCION,
//        reemplaza la instrucción técnica cruda:
//          "CONFIRMAR_MATERIALES_PRODUCCION con id_orden: X"
//        por lenguaje natural que el LLM del operario puede procesar:
//          "Cuando tengas los insumos listos, responde:
//           confirmo materiales orden X"
//        Esto evita que el operario tenga que recordar el nombre exacto
//        del comando y permite que BB Cloud lo interprete correctamente.
//  [19]  FIX RBAC getOrCreateBotUser:
//        Buscaba SOLO por email phone@wa.bot → supervisor que respondía
//        desde WhatsApp era registrado como ghost Operario, bloqueando RBAC.
//        Fix: primero busca por `telefono` en usuarios reales (activos, no
//        bots); sólo si no hay match crea/retorna el ghost bot.
// =============================================================
const mysql  = require('mysql2/promise');
const https  = require('https');
const { randomUUID, timingSafeEqual } = require('crypto');
const { requireWebhookSecret } = require('../../_lib/auth');
const { capabilityForAction, hasCapability } = require('../../_lib/capabilities');
const { confirmImportedDispatch } = require('../../_lib/dispatch-workflow');
const { createCustomerReturn, parseCustomerReturnReferences } = require('../../_lib/returns-workflow');
const { reportWaste, parseWasteReferences } = require('../../_lib/waste-workflow');
const { releaseProductionOrder, confirmProductionMaterials } = require('../../_lib/production-workflow');
const { adjustProductionMaterials } = require('../../_lib/production-materials');
const { closeProductionOrder } = require('../../_lib/production-close');
const {
  normalizeProductionCloseParams,
  parseProductionCloseFromText: parseProductionCloseInput,
} = require('../../_lib/production-close-input');
const { workflowFlags } = require('../../_lib/feature-flags');
const { formatPendingApprovals } = require('../../_lib/pending-approvals');
const { formatCapacityCheck, getEligibleStock } = require('../../_lib/manufacturing-capacity');
const { assertInternalProductionProduct } = require('../../_lib/product-modes');

const DB = () => mysql.createConnection({
  host:           process.env.DB_HOST,
  port:           parseInt(process.env.DB_PORT || '3306'),
  user:           process.env.DB_USER,
  password:       process.env.DB_PASSWORD,
  database:       process.env.DB_NAME || 'kainotomia_WMS',
  connectTimeout: 10000,
});

// BB Cloud API token y Bot ID
const BB_TOKEN  = process.env.BUILDERBOT_API_TOKEN || '';
const BB_BOT_ID = process.env.BUILDERBOT_BOT_ID || '';

function normalizeWhatsAppPhone(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (/^3\d{9}$/.test(digits)) return `57${digits}`;
  if (/^573\d{9}$/.test(digits)) return digits;
  return null;
}

function builderbotResponse(res, status, body) {
  const msg = body.mensaje || body.message || '';
  return res.status(status).json({
    ...body,
    message: msg,
    mensaje: msg,
    buttons: Array.isArray(body.buttons) ? body.buttons : [],
    context: body.context && typeof body.context === 'object' ? body.context : {},
  });
}

function parseBuilderBotInfo(rawBody) {
  const candidates = [
    rawBody.info,
    rawBody.aiResponse,
    rawBody.ai_response,
    rawBody.response,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        return {};
      }
    }
    if (typeof candidate === 'object') return candidate;
  }

  return rawBody && typeof rawBody === 'object' ? rawBody : {};
}

function getUserText(rawBody, info) {
  return info.body ||
         info.text ||
         info.query ||
         info.texto ||
         info.content ||
         info.message ||
         info.params?.body ||
         info.params?.text ||
         info.params?.query ||
         info.params?.texto ||
         info.params?.message ||
         rawBody.body ||
         rawBody.text ||
         rawBody.query ||
         rawBody.texto ||
         rawBody.message ||
         '';
}

function isGreeting(text) {
  return /^(hola|buenas|buenos dias|buenos d[ií]as|buenas tardes|buenas noches|hello|hi)\b/i
    .test(String(text || '').trim());
}

function builderbotKw(info, rawBody) {
  return info.kw ||
         info.keyword ||
         rawBody.kw ||
         rawBody.keyword ||
         '';
}

function requireBuilderBotAccess(req, info, rawBody) {
  try {
    requireWebhookSecret(req);
    return;
  } catch (err) {
    const expectedKw = process.env.BUILDERBOT_KW || 'g0m@s';
    const receivedKw = builderbotKw(info, rawBody);
    if (receivedKw && expectedKw && safeKwEqual(receivedKw, expectedKw)) {
      return;
    }
    throw err;
  }
}

function safeKwEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

// ─────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// [FIX 17] parsearAprobacionNatural
// Detecta en texto libre si el supervisor está aprobando o
// rechazando una solicitud, sin necesidad de comando exacto.
// Retorna { action, params } si lo detecta, o null si no.
// ─────────────────────────────────────────────────────────────
function parsearAprobacionNatural(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  const txt = rawText.trim().toLowerCase();

  // Extraer código REQ-XXXXXX (case-insensitive, con o sin guion)
  const matchReq = rawText.match(/REQ-\d{4,8}/i);
  if (!matchReq) return null;
  const idSolicitud = matchReq[0].toUpperCase();

  // Patrones de APROBACIÓN
  const patronesAprobacion = [
    /\baprueb[oa]\b/,
    /\baprobar\b/,
    /\bautorizo\b/,
    /\bautorizar\b/,
    /\bconfirmo\b/,
    /\bconfirmar\b/,
    /\bsi\s+aprueb[oa]\b/,
    /\bs[íi]\s+aprueb[oa]\b/,
    /\bsi\s+autorizo\b/,
    /\bs[íi]\s+autorizo\b/,
    /\bok\s+aprueb[oa]\b/,
    /\bproceder\b/,
    /\bprocede\b/,
    /\baprobado\b/,
    /\bautorizado\b/,
    /\bdar paso\b/,
    /\bvisto bueno\b/,
    /\bvb\b/,
  ];

  // Patrones de RECHAZO
  const patronesRechazo = [
    /\brechaz[oa]\b/,
    /\brechazar\b/,
    /\bno\s+aprueb[oa]\b/,
    /\bno\s+autorizo\b/,
    /\bdeneg[ao]\b/,
    /\bdenegar\b/,
    /\bcancelar\b/,
    /\bcancelo\b/,
    /\bno\s+procede\b/,
    /\brechazado\b/,
    /\bno\s+autorizado\b/,
  ];

  for (const patron of patronesAprobacion) {
    if (patron.test(txt)) {
      console.log(`[parsearAprobacionNatural] ✅ Detectada APROBACIÓN natural: "${rawText.slice(0,80)}" → id_solicitud="${idSolicitud}"`);
      return { action: 'APROBAR_SOLICITUD', params: { id_solicitud: idSolicitud } };
    }
  }

  for (const patron of patronesRechazo) {
    if (patron.test(txt)) {
      // Intentar extraer motivo: todo lo que viene después del REQ-xxx
      const motivoMatch = rawText.match(/REQ-\d{4,8}\s*[,\-–]?\s*(.+)/i);
      const motivo = motivoMatch ? motivoMatch[1].trim() : null;
      console.log(`[parsearAprobacionNatural] ❌ Detectado RECHAZO natural: "${rawText.slice(0,80)}" → id_solicitud="${idSolicitud}" motivo="${motivo}"`);
      return { action: 'RECHAZAR_SOLICITUD', params: { id_solicitud: idSolicitud, motivo } };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function hasDispatchIntent(text) {
  return /\b(despach|envi|mandar|sacar|salida)\w*\b/i.test(String(text || ''));
}

async function triggerInvoiceImport() {
  const baseUrl = String(process.env.WMS_PUBLIC_URL || '').trim();
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!baseUrl || !secret) throw new Error('WMS_PUBLIC_URL o CRON_SECRET no configurado');
  const url = new URL('/api/v1/siigo/import-invoices', baseUrl);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 207) {
    throw new Error(payload.error || `Error HTTP ${response.status} al consultar Siigo`);
  }
  return payload;
}

function inferProductionCloseReasonFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const explicit = raw.match(/(?:por|porque|motivo|causa)\s+(.+)$/i);
  if (explicit) return explicit[1].trim();

  const clean = raw
    .replace(/^(?:motivo|causa|raz[oó]n)\s*[:\-]?\s*/i, '')
    .trim();
  if (!clean) return null;
  if (/^\d+(?:[.,]\d+)?\s*(?:und|unidad(?:es)?|uds?|u)?$/i.test(clean)) return null;
  if (/\b(?:OP|ORD|P)-[A-Z0-9-]+\b/i.test(clean)) return null;
  if (/\b(cerr|cierre|cerramos|finaliz|termin|producci[oó]n|produccion|conforme|resultante|merma)\w*\b/i.test(clean)) return null;
  if (clean.length < 4) return null;
  return clean;
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function findRecentProductionCloseReason(db, from, orderId) {
  if (!from) return null;
  const [rows] = await db.execute(
    `SELECT payload
     FROM webhook_logs
     WHERE from_phone = ?
       AND created_at >= DATE_SUB(NOW(), INTERVAL 20 MINUTE)
     ORDER BY created_at DESC
     LIMIT 12`,
    [from]
  ).catch(() => [[]]);

  for (const row of rows) {
    const payload = asObject(row.payload);
    const info = parseBuilderBotInfo(payload);
    const action = info['@ction'] || info.action || payload['@ction'] || payload.action || '';
    const params = normalizeOperationalParams(action, info.params || {});
    const rawText = getUserText(payload, info);

    if (params.motivo_merma || params.motivo) return params.motivo_merma || params.motivo;

    const parsedClose = parseProductionCloseInput(rawText);
    if (parsedClose?.params?.motivo_merma) {
      if (!orderId || parsedClose.params.id_orden === String(orderId).toUpperCase()) {
        return parsedClose.params.motivo_merma;
      }
    }

    const inferred = inferProductionCloseReasonFromText(rawText);
    if (inferred && (action === 'CERRAR_ORDEN_PRODUCCION' || action === 'SOLICITAR_CIERRE_PRODUCCION' || action === 'MODO_CHARLA' || action === 'UNKNOWN' || !action)) {
      return inferred;
    }
  }

  return null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function formatDateOnly(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('es-CO', { timeZone: 'UTC' });
}

function normalizeOperationalParams(action, params) {
  const next = { ...(params || {}) };
  if (action === 'CERRAR_ORDEN_PRODUCCION' || action === 'SOLICITAR_CIERRE_PRODUCCION') {
    return normalizeProductionCloseParams(next);
  }
  if (action === 'SOLICITAR_DESPACHO') {
    next.id_lote = firstDefined(next.id_lote, next.lote, next.lpn);
    next.id_item = firstDefined(next.id_item, next.sku, next.producto, next.product_id, next.producto_id);
    next.cliente_destino = firstDefined(next.cliente_destino, next.cliente, next.customer);
  }
  return next;
}

async function saveLog(db, { from, action, priority, payload, response, status }) {
  await db.execute(
    `INSERT INTO webhook_logs (from_phone, action, priority, payload, response, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [from || null, action, priority || 'baja',
     JSON.stringify(payload), JSON.stringify(response || {}), status]
  ).catch(() => {});
}

async function logSystemEvent(db, { nivel, modulo, mensaje, usuario_id, payload }) {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS system_logs (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       nivel ENUM('INFO','WARN','ERROR','DEBUG') NOT NULL DEFAULT 'INFO',
       modulo VARCHAR(50) NOT NULL DEFAULT 'webhook',
       mensaje TEXT NOT NULL,
       usuario_id INT UNSIGNED NULL,
       payload JSON NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_syslogs_nivel (nivel),
       INDEX idx_syslogs_modulo (modulo),
       INDEX idx_syslogs_created (created_at)
     )`
  ).catch(() => {});
  await db.execute(
    `INSERT INTO system_logs (nivel, modulo, mensaje, usuario_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [nivel || 'INFO', modulo || 'webhook', mensaje, usuario_id || null,
     payload ? JSON.stringify(payload) : null]
  ).catch(() => {});
}

async function ensureWasteTable(db) {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS mermas (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       numero VARCHAR(40) NOT NULL UNIQUE,
       tipo VARCHAR(60) NOT NULL,
       producto_id INT UNSIGNED NOT NULL,
       lote VARCHAR(100) NULL,
       orden_produccion_id INT UNSIGNED NULL,
       cantidad DECIMAL(15,4) NOT NULL,
       motivo TEXT NULL,
       usuario_id INT UNSIGNED NULL,
       creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_mermas_creado_en (creado_en),
       INDEX idx_mermas_producto (producto_id),
       INDEX idx_mermas_lote (lote),
       INDEX idx_mermas_op (orden_produccion_id)
     )`
  );
}

async function recordProductionCloseWaste(db, { orden, qtyWaste, reason, userId }) {
  if (!(Number(qtyWaste) > 0)) return null;
  await ensureWasteTable(db);
  const numero = `MER-${Date.now()}`;
  await db.execute(
    `INSERT INTO mermas
       (numero, tipo, producto_id, lote, orden_produccion_id, cantidad, motivo, usuario_id, creado_en)
     VALUES (?, 'MERMA_CIERRE_WIP', ?, NULL, ?, ?, ?, ?, NOW())`,
    [numero, orden.producto_id, orden.id, qtyWaste, reason || null, userId]
  );
  return numero;
}

async function createLot(db, { lpn, product_id, bodega_id, qty, supplier, origin, received_by, notes, expiry_date }) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO lots
       (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, origin, status, received_by, notes, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DISPONIBLE', ?, ?, ?)`,
    [id, lpn, product_id, bodega_id, qty, qty,
     supplier || null, origin || 'RECEPCION', received_by || null,
     notes || null, expiry_date || null]
  ).catch(e => console.error('[createLot]', e.message));
  return id;
}

async function lotIdByLpn(db, lpn) {
  if (!lpn) return null;
  const [rows] = await db.execute(
    `SELECT id FROM lots WHERE lpn = ? LIMIT 1`, [lpn]
  ).catch(() => [[]]);
  return rows[0]?.id || null;
}

async function logKardex(db, { product_id, user_id, action, qty,
                               lot_id, balance_after, reference, notes, approved_by }) {
  await db.execute(
    `INSERT INTO kardex
       (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after, reference, notes, approved_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [randomUUID(), randomUUID(), lot_id || null, product_id, user_id,
     action, qty, balance_after ?? null, reference || null,
     notes || null, approved_by || null]
  ).catch(e => console.error('[logKardex]', e.message, action, product_id));
}

async function getStockBalance(db, product_id, bodega_id) {
  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE producto_id = ? AND bodega_id = ?`,
    [product_id, bodega_id]
  );
  return parseFloat(rows[0]?.total || 0);
}

async function findProductBySku(db, sku) {
  const [rows] = await db.execute(
    `SELECT p.* FROM productos p
     INNER JOIN skus s ON s.producto_id = p.id
     WHERE s.sku = ? AND p.activo = 1 LIMIT 1`, [sku]
  );
  if (rows.length) return rows[0];
  const [rows2] = await db.execute(
    `SELECT * FROM productos WHERE siigo_code = ? AND activo = 1 LIMIT 1`, [sku]
  );
  if (!rows2.length) throw { status: 404, message: `Producto "${sku}" no encontrado` };
  return rows2[0];
}

async function getDefaultBodega(db) {
  const [rows] = await db.execute(
    `SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`
  );
  if (!rows.length) throw { status: 500, message: 'No hay bodegas configuradas' };
  return rows[0].id;
}

async function getOrCreateBotUser(db, phone) {
  // [FIX 19] Buscar primero por teléfono en usuarios reales.
  // Resuelve el caso del supervisor que responde desde WhatsApp
  // con su número real en vez de con su email.
  const [realRows] = await db.execute(
    `SELECT u.*, r.nombre AS rol_nombre FROM usuarios u
     LEFT JOIN roles r ON r.id = u.rol_id
     WHERE u.telefono = ?
       AND u.activo = 1
       AND u.email NOT LIKE '%@wa.bot'
     LIMIT 1`, [phone]
  );
  if (realRows.length) {
    console.log(`[getOrCreateBotUser] ✅ Usuario real por teléfono: id=${realRows[0].id} rol=${realRows[0].rol_nombre}`);
    return realRows[0];
  }

  // [FIX 20] Número no registrado → null. NO se crean ghost bots.
  // Un número desconocido no tiene por qué acceder al sistema.
  // El handler principal intercepta null y devuelve 403.
  console.warn(`[getOrCreateBotUser] ⛔ Número no registrado: ${phone} — acceso denegado`);
  return null;
}

async function nextRecepcionNumero(db) {
  const d = new Date();
  const prefix = `REC-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS cnt FROM recepciones WHERE numero LIKE ?`, [`${prefix}%`]
  );
  const seq = String((rows[0].cnt || 0) + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
}

async function nextSolicitudCodigo(db) {
  const [rows] = await db.execute(`SELECT COUNT(*) AS cnt FROM aprobaciones`);
  return `REQ-${String((rows[0].cnt || 0) + 1).padStart(6, '0')}`;
}

async function upsertStock(db, { producto_id, bodega_id, lote, cantidad }) {
  const [ex] = await db.execute(
    `SELECT id FROM stock
     WHERE producto_id=? AND bodega_id=? AND (lote=? OR (lote IS NULL AND ? IS NULL)) LIMIT 1`,
    [producto_id, bodega_id, lote, lote]
  );
  if (ex.length) {
    await db.execute(`UPDATE stock SET cantidad = cantidad + ? WHERE id = ?`, [cantidad, ex[0].id]);
  } else {
    await db.execute(
      `INSERT INTO stock (producto_id, bodega_id, lote, cantidad) VALUES (?,?,?,?)`,
      [producto_id, bodega_id, lote || null, cantidad]
    );
  }
}

async function nextCodigoOrden(db) {
  const d = new Date();
  const prefix = `OP-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS cnt FROM ordenes_produccion WHERE codigo_orden LIKE ?`, [`${prefix}%`]
  );
  return `${prefix}-${String((rows[0].cnt || 0) + 1).padStart(4,'0')}`;
}

function normalizarEstadoDevolucion(estado) {
  const map = {
    'recuperable': 'RECUPERABLE',
    'destruccion': 'DESTRUCCION',
    'destrucción': 'DESTRUCCION',
    'cuarentena':  'CUARENTENA',
  };
  return map[(estado || '').toLowerCase()] || 'CUARENTENA';
}

function roundQty(n) {
  return parseFloat(parseFloat(n).toFixed(4));
}

// ─────────────────────────────────────────────────────────────
// [FIX 16] pushWA — async, retorna Promise. No es fire-and-forget.
// ─────────────────────────────────────────────────────────────
async function pushWA(phone, text) {
  return new Promise((resolve) => {
    try {
      const rawPhone = String(phone);
      const number   = normalizeWhatsAppPhone(rawPhone);

      console.log(`[pushWA] Intentando enviar WA`);
      console.log(`[pushWA]   phone original  : "${rawPhone}"`);
      console.log(`[pushWA]   number sanitizado: "${number}"`);
      console.log(`[pushWA]   destino URL     : app.builderbot.cloud/api/v2/${BB_BOT_ID}/messages`);
      console.log(`[pushWA]   texto (primeros 120 chars): ${String(text).slice(0, 120)}`);

      if (!number) {
        console.warn('[pushWA] ⚠️  Número vacío tras sanitizar — se omite envío.');
        return resolve({ status: 'INVALID_PHONE', body: `Telefono invalido: ${rawPhone}` });
      }

      if (!BB_TOKEN || !BB_BOT_ID) {
        console.warn('[pushWA] BuilderBot no configurado; se omite envio.');
        return resolve({
          status: 'CONFIG_MISSING',
          body: JSON.stringify({ hasToken: Boolean(BB_TOKEN), hasBotId: Boolean(BB_BOT_ID) }),
        });
      }

      const body = JSON.stringify({
        number,
        messages: { content: text },
      });

      console.log(`[pushWA]   body JSON: ${body.slice(0, 300)}`);

      const req = https.request({
        hostname: 'app.builderbot.cloud',
        path:     `/api/v2/${BB_BOT_ID}/messages`,
        method:   'POST',
        headers:  {
          'Content-Type':     'application/json',
          'x-api-builderbot': BB_TOKEN,
          'Authorization':    `Bearer ${BB_TOKEN}`,
          'Content-Length':   Buffer.byteLength(body),
        },
      }, res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            console.error(`[pushWA] ❌ BB Cloud respondió ${res.statusCode} para "${number}":`, raw.slice(0, 400));
          } else {
            console.log(`[pushWA] ✅ BB Cloud respondió ${res.statusCode} para "${number}":`, raw.slice(0, 200));
          }
          resolve({ status: res.statusCode, body: raw.slice(0, 400) });
        });
      });

      req.on('error', e => {
        console.error('[pushWA] Error de red:', e.message);
        resolve({ status: 'NETWORK_ERROR', body: e.message });
      });

      req.write(body);
      req.end();

    } catch (e) {
      console.error('[pushWA] Excepcion:', e.message);
      resolve({ status: 'EXCEPTION', body: e.message });
    }
  });
}

// ─────────────────────────────────────────────────────────────
// getSupervisorPhone — logging detallado
// ─────────────────────────────────────────────────────────────
async function getSupervisorPhone(db) {
  const [candidates] = await db.execute(
    `SELECT u.id, u.nombre, u.email, u.telefono, u.activo, LOWER(r.nombre) AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE LOWER(r.nombre) IN ('supervisor','admin')
     ORDER BY FIELD(LOWER(r.nombre), 'supervisor', 'admin') ASC, u.id ASC
     LIMIT 20`
  ).catch(() => [[]]);

  console.log(`[getSupervisorPhone] Candidatos supervisor/admin en BD (${candidates.length} total):`);
  for (const c of candidates) {
    const esBot    = c.email && c.email.endsWith('@wa.bot');
    const tienetel = c.telefono != null && String(c.telefono).trim() !== '';
    console.log(
      `[getSupervisorPhone]   id=${c.id} | rol=${c.rol} | activo=${c.activo}` +
      ` | telefono=${c.telefono === null ? 'NULL' : `"${c.telefono}"`}` +
      ` | email=${c.email}` +
      ` | esBot=${esBot} | tienetel=${tienetel}` +
      ` | APTO=${!esBot && tienetel && c.activo == 1}`
    );
  }

  const [rows] = await db.execute(
    `SELECT u.telefono FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE LOWER(r.nombre) IN ('supervisor','admin')
       AND u.activo = 1
       AND u.telefono IS NOT NULL
       AND u.email NOT LIKE '%@wa.bot'
     ORDER BY FIELD(LOWER(r.nombre), 'supervisor', 'admin') ASC,
              u.id ASC
     LIMIT 20`
  ).catch(() => [[]]);

  const phone = rows.map(r => normalizeWhatsAppPhone(r.telefono)).find(Boolean) || null;
  if (phone) {
    console.log(`[getSupervisorPhone] ✅ Teléfono seleccionado: "${phone}"`);
  } else {
    console.warn('[getSupervisorPhone] ⚠️  No se encontró ningún supervisor/admin activo con teléfono registrado.');
  }
  return phone;
}

// getSupervisorPhones — retorna TODOS los teléfonos de supervisores/admin activos
async function getSupervisorPhones(db) {
  const [rows] = await db.execute(
    `SELECT u.telefono FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE LOWER(r.nombre) IN ('supervisor','admin')
       AND u.activo = 1
       AND u.telefono IS NOT NULL
       AND u.email NOT LIKE '%@wa.bot'
     ORDER BY FIELD(LOWER(r.nombre), 'supervisor', 'admin') ASC,
              u.id ASC`
  ).catch(() => [[]]);
  const phones = [...new Set(rows.map(r => normalizeWhatsAppPhone(r.telefono)).filter(Boolean))];
  console.log(`[getSupervisorPhones] ${phones.length} destinatario(s): [${phones.join(', ')}]`);
  return phones;
}

function estadoLoteDevolucion(estado) {
  if (estado === 'RECUPERABLE') return 'DISPONIBLE';
  if (estado === 'CUARENTENA') return 'CUARENTENA';
  return 'PENDIENTE_DISPOSICION';
}

function pushWasAccepted(result) {
  return result && Number(result.status) >= 200 && Number(result.status) < 300;
}

async function notifySupervisorPhones(db, { phones, text, action, codigo, userId }) {
  if (!phones.length) {
    await logSystemEvent(db, {
      modulo: 'whatsapp',
      nivel: 'WARN',
      mensaje: `Sin destinatarios para notificar ${codigo || action}`,
      usuario_id: userId,
      payload: { action, codigo, phones: [] },
    });
    return { ok: false, accepted: [], failed: [], results: [] };
  }

  const results = await Promise.all(phones.map(async (phone) => {
    const result = await pushWA(phone, text);
    return {
      phone,
      status: result?.status || null,
      ok: pushWasAccepted(result),
      body: result?.body || null,
    };
  }));
  const accepted = results.filter(r => r.ok).map(r => r.phone);
  const failed = results.filter(r => !r.ok).map(r => ({ phone: r.phone, status: r.status, body: String(r.body || '').slice(0, 300) }));

  await logSystemEvent(db, {
    modulo: 'whatsapp',
    nivel: accepted.length ? 'INFO' : 'ERROR',
    mensaje: `Notificacion ${codigo || action}: ${accepted.length}/${phones.length} aceptada(s) por BuilderBot`,
    usuario_id: userId,
    payload: { action, codigo, accepted, failed },
  });

  return { ok: accepted.length > 0, accepted, failed, results };
}

function supervisorNotificationLine(notification) {
  if (notification?.ok) return 'El supervisor fue notificado.';
  return 'No pude confirmar la notificacion al supervisor. La solicitud quedo pendiente en dashboard.';
}

async function queryStockDisponible(db, { sku, bodega, tipoFiltro }) {
  try {
    if (sku) {
      const [rows] = await db.execute(
        `SELECT lote, disponible, vence, estado_lote
         FROM v_stock_disponible
         WHERE sku = ? AND bodega = ?
         ORDER BY CASE WHEN vence IS NULL THEN 1 ELSE 0 END, vence ASC, lote ASC`,
        [sku, bodega]
      );
      return { modo: 'vista', rows };
    } else {
      const [rows] = await db.execute(
        `SELECT sku, nombre, SUM(disponible) AS total
         FROM v_stock_disponible
         WHERE tipo_producto = ? AND bodega = ?
         GROUP BY sku, nombre
         ORDER BY total DESC LIMIT 10`,
        [tipoFiltro, bodega]
      );
      return { modo: 'vista_resumen', rows };
    }
  } catch (_) {
    if (sku) {
      const [rows] = await db.execute(
        `SELECT s.lote,
                (s.cantidad - s.reservada) AS disponible,
                l.expiry_date AS vence,
                COALESCE(l.status, 'DISPONIBLE') AS estado_lote,
                b.codigo AS bodega_codigo
         FROM stock s
         JOIN productos p  ON p.id  = s.producto_id
         JOIN bodegas   b  ON b.id  = s.bodega_id
         LEFT JOIN lots l  ON l.lpn = s.lote
         WHERE p.siigo_code = ?
         ORDER BY b.id ASC,
                  CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END,
                  l.expiry_date ASC, s.id ASC`,
        [sku]
      );
      return { modo: 'fallback', rows };
    } else {
      const [rows] = await db.execute(
        `SELECT p.siigo_code AS sku, p.nombre,
                COALESCE(SUM(s.cantidad - s.reservada), 0) AS total
         FROM productos p
         LEFT JOIN stock s ON s.producto_id = p.id
         WHERE p.activo = 1 AND p.tipo_producto = ?
         GROUP BY p.id ORDER BY total DESC LIMIT 10`,
        [tipoFiltro]
      );
      return { modo: 'fallback_resumen', rows };
    }
  }
}

// findFifoLot — selecciona el lote FIFO más antiguo con stock disponible
async function findFifoLot(db, sku, bodegaId) {
  try {
    const [bodRow] = await db.execute(
      `SELECT codigo FROM bodegas WHERE id = ? LIMIT 1`, [bodegaId]
    ).catch(() => [[]]);
    const bodCod = bodRow[0]?.codigo || 'BG-PPAL';

    const [rows] = await db.execute(
      `SELECT lote, disponible, vence
       FROM v_stock_disponible
       WHERE sku = ? AND bodega = ?
         AND estado_lote = 'DISPONIBLE'
         AND lote IS NOT NULL
         AND disponible > 0
       ORDER BY CASE WHEN vence IS NULL THEN 1 ELSE 0 END, vence ASC, lote ASC`,
      [sku, bodCod]
    );

    const lots = rows.map(r => ({
      lpn: r.lote,
      disponible: parseFloat(r.disponible || 0),
      vence: r.vence || null,
      modo: 'vista'
    }));
    if (lots.length) return lots[0];
  } catch (_) {}

  const [rows] = await db.execute(
    `SELECT s.lote,
            (s.cantidad - s.reservada) AS disponible,
            l.expiry_date AS vence
     FROM stock s
     JOIN productos p ON p.id = s.producto_id
     LEFT JOIN lots l ON l.lpn = s.lote
     WHERE p.siigo_code = ?
       AND s.bodega_id = ?
       AND s.lote IS NOT NULL
       AND (s.cantidad - s.reservada) > 0
       AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
     ORDER BY CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END,
              l.expiry_date ASC, s.id ASC`,
    [sku, bodegaId]
  ).catch(() => [[]]);

  const lots = rows.map(r => ({
    lpn: r.lote,
    disponible: parseFloat(r.disponible || 0),
    vence: r.vence || null,
    modo: 'fallback'
  }));
  return lots[0] || null;
}

// ─────────────────────────────────────────────────────────────
// executeApprovedPayload — acciones que requieren aprobación
// ─────────────────────────────────────────────────────────────
async function executeApprovedPayload(db, { accion, payload, aprobador_id, bodegaId }) {
  switch (accion) {

    case 'SOLICITAR_INICIO_PRODUCCION': {
      const [ordenRows] = await db.execute(
        `SELECT op.*, p.siigo_code, p.modalidad_operativa
         FROM ordenes_produccion op
         JOIN productos p ON p.id = op.producto_id
         WHERE op.id = ? LIMIT 1`, [payload.order_id]
      );
      if (!ordenRows.length) throw { status: 404, message: `Orden #${payload.order_id} no encontrada` };
      const orden = ordenRows[0];
      assertInternalProductionProduct(orden);

      const [bom] = await db.execute(
        `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
                pr.siigo_code, pr.nombre
         FROM bom b
         JOIN productos pr ON pr.id = b.insumo_id
         WHERE b.producto_final_id = ? AND b.etapa = 'PRODUCCION'`, [orden.producto_id]
      ).catch(() => [[]]);

      const reservados = [];
      for (const item of bom) {
        const cantInsumo = roundQty(parseFloat(item.cantidad_por_unidad) * parseFloat(orden.cantidad_planeada));
        if (cantInsumo <= 0) continue;
        await db.execute(
          `UPDATE stock
           SET reservada = reservada + ?
           WHERE producto_id = ? AND bodega_id = ?
             AND (cantidad - reservada) >= 0
           ORDER BY id ASC LIMIT 1`,
          [cantInsumo, item.insumo_id, bodegaId]
        ).catch(() => {});
        reservados.push(`  • ${item.siigo_code}: ${cantInsumo} ${item.unidad}`);
      }

      await db.execute(
        `UPDATE ordenes_produccion
         SET estado = 'APROBADA', aprobado_por = ?
         WHERE id = ?`,
        [aprobador_id, orden.id]
      );

      // [FIX 18] Mensaje al operario en lenguaje natural para que BB Cloud
      // lo procese correctamente sin necesidad de comando técnico exacto.
      if (payload.operario_phone) {
        console.log(`[APROBAR_SOLICITUD] Enviando WA confirmación al operario: "${payload.operario_phone}"`);
        await pushWA(
          payload.operario_phone,
          [
            `✅ *Orden ${orden.codigo_orden} APROBADA*`,
            `Tu solicitud fue validada. Los materiales están reservados.`,
            `Cuando tengas los insumos listos físicamente, responde:`,
            `*confirmo materiales orden ${orden.codigo_orden}*`,
            ``, `📦 *Materiales reservados:*`,
            ...reservados
          ].join('\n')
        );
      } else {
        console.warn(`[APROBAR_SOLICITUD] operario_phone no está en el payload — no se notificará al operario.`);
      }

      return { orden: orden.codigo_orden, estado: 'APROBADA', reservados: reservados.length };
    }

    case 'SOLICITAR_CIERRE_PRODUCCION': {
      const [rows] = await db.execute(
        `SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1`, [payload.order_id]
      );
      if (!rows.length) throw { status: 404, message: `Orden #${payload.order_id} no encontrada` };
      const orden = rows[0];

      if (orden.estado !== 'EN_PROCESO') {
        throw {
          status: 409,
          message: `La orden ${orden.codigo_orden} está en estado "${orden.estado}" y no puede cerrarse. Debe estar EN_PROCESO.`,
        };
      }

      const cantReal = payload.qty_real != null
        ? Number(payload.qty_real)
        : Number(orden.cantidad_planeada);
      const qtyWaste = Number(payload.qty_waste ?? payload.merma ?? 0);
      const motivoMerma = payload.motivo_merma || payload.motivo || null;

      await db.execute(
        `UPDATE ordenes_produccion
         SET estado='CERRADA', cantidad_real=?, aprobado_por=?, cerrado_en=NOW()
         WHERE id=?`,
        [cantReal, aprobador_id, orden.id]
      );
      const [prodRows] = await db.execute(
        `SELECT siigo_code FROM productos WHERE id = ? LIMIT 1`,
        [orden.producto_id]
      );
      const skuPT = prodRows[0]?.siigo_code || `PT-${orden.producto_id}`;
      const lpnOP = `L-${skuPT}-${orden.codigo_orden}-${Date.now()}`;

      const lotId = await createLot(db, {
        lpn: lpnOP, product_id: orden.producto_id, bodega_id: bodegaId,
        qty: cantReal, origin: 'PRODUCCION', received_by: aprobador_id,
        notes: `Orden de producción ${orden.codigo_orden}`,
      });
      await upsertStock(db, { producto_id: orden.producto_id, bodega_id: bodegaId, lote: lpnOP, cantidad: cantReal });
      await db.execute(
        `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
         VALUES ('entrada',?,?,?,?,?,'orden_produccion',?)`,
        [orden.producto_id, bodegaId, lpnOP, cantReal, orden.id, aprobador_id]
      );
      const balance = await getStockBalance(db, orden.producto_id, bodegaId);
      await logKardex(db, {
        product_id: orden.producto_id, user_id: aprobador_id,
        action: 'CIERRE_PRODUCCION', qty: cantReal, lot_id: lotId,
        balance_after: balance, reference: `orden_produccion:${orden.id}`,
        notes: qtyWaste > 0 ? `Merma cierre: ${qtyWaste} | Motivo: ${motivoMerma || 'No especificado'}` : 'Cierre sin merma',
        approved_by: aprobador_id,
      });
      const numeroMerma = await recordProductionCloseWaste(db, {
        orden,
        qtyWaste,
        reason: motivoMerma,
        userId: aprobador_id,
      });
      await logSystemEvent(db, {
        modulo: 'produccion', nivel: 'INFO',
        mensaje: `Orden ${orden.codigo_orden} CERRADA — ${cantReal} und producidas`,
        usuario_id: aprobador_id,
        payload: { orden_id: orden.id, codigo_orden: orden.codigo_orden, cantReal, lote: lpnOP, merma: qtyWaste, numero_merma: numeroMerma },
      });
      if (payload.operario_phone) {
        console.log(`[CIERRE_PRODUCCION] Enviando WA confirmación al operario: "${payload.operario_phone}"`);
        await pushWA(
          payload.operario_phone,
          `✅ *Cierre de orden ${orden.codigo_orden} aprobado*\nPT ingresado: ${cantReal} und — Lote ${lpnOP}`
        );
      } else {
        console.warn(`[CIERRE_PRODUCCION] operario_phone no está en el payload — no se notificará al operario.`);
      }
      return { orden: orden.codigo_orden, lote: lpnOP, cantidad: cantReal, merma: qtyWaste, numero_merma: numeroMerma };
    }

    case 'SOLICITAR_DESPACHO': {
  const cantDesp  = Number(payload.qty) || 0;
  const lotIdDesp = await lotIdByLpn(db, payload.lpn);

  if (payload.lpn) {
    const [stockUpdate] = await db.execute(
      `UPDATE stock SET cantidad = cantidad - ?
       WHERE producto_id=? AND bodega_id=? AND lote=? AND cantidad >= ? LIMIT 1`,
      [cantDesp, payload.product_id, bodegaId, payload.lpn, cantDesp]
    );
    if (stockUpdate.affectedRows !== 1) {
      throw { status: 409, message: `Stock insuficiente para despachar lote ${payload.lpn}` };
    }

    // [FIX 27b] Dos queries separadas: primero actualizar qty, luego evaluar status
    // con el valor ya actualizado. Un solo SET doble tiene ambigüedad en MySQL.
    const [lotUpdate] = await db.execute(
      `UPDATE lots SET qty_current = qty_current - ? WHERE lpn = ? AND qty_current >= ?`,
      [cantDesp, payload.lpn, cantDesp]
    );
    if (lotUpdate.affectedRows !== 1) {
      throw { status: 409, message: `Stock insuficiente para despachar lote ${payload.lpn}` };
    }
    await db.execute(
      `UPDATE lots SET status = IF(qty_current <= 0, 'DESPACHADO', 'DISPONIBLE') WHERE lpn = ?`,
      [payload.lpn]
    ).catch(() => {});
  }

  // [FIX 27] balance_after = saldo del lote específico (no suma total del producto)
  const [lotBalRow] = payload.lpn
    ? await db.execute(`SELECT qty_current FROM lots WHERE lpn = ? LIMIT 1`, [payload.lpn]).catch(() => [[]])
    : [[]];
  const lotBalance = lotBalRow[0] != null ? parseFloat(lotBalRow[0].qty_current) : 0;

  const numeroDespacho = `DSP-${Date.now()}`;

 const [despIns] = await db.execute(
  `INSERT INTO despachos
     (numero, cliente_nombre, bodega_id, producto_id, lote, cantidad, estado, usuario_id, observaciones, creado_en, despachado_en)
   VALUES (?, ?, ?, ?, ?, ?, 'despachado', ?, ?, NOW(), NOW())`,
  [
    numeroDespacho,
    payload.customer || null,
    bodegaId,
    payload.product_id,
    payload.lpn || null,
    cantDesp,
    aprobador_id,
    `Despacho aprobado desde WhatsApp`
  ]
);

  await db.execute(
    `INSERT INTO despacho_items
       (despacho_id, producto_id, ubicacion_id, lote, cantidad_sol, cantidad_des)
     VALUES (?, ?, NULL, ?, ?, ?)`,
    [despIns.insertId, payload.product_id, payload.lpn || null, cantDesp, cantDesp]
  ).catch(() => {});

  await db.execute(
    `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
     VALUES ('salida',?,?,?,?,?,'despacho_aprobado',?)`,
    [payload.product_id, bodegaId, payload.lpn || null, cantDesp, despIns.insertId, aprobador_id]
  );

  await logKardex(db, {
    product_id: payload.product_id,
    user_id: aprobador_id,
    action: 'DESPACHO',
    qty: -cantDesp,
    lot_id: lotIdDesp,
    balance_after: lotBalance,
    reference: `despacho:${numeroDespacho}`,
    notes: payload.customer ? `Cliente: ${payload.customer}` : null,
    approved_by: aprobador_id,
  });

  if (payload.operario_phone) {
    const saldoLinea = payload.lpn ? `\nSaldo lote: ${lotBalance} und` : '';
    await pushWA(
      payload.operario_phone,
      `✅ *Despacho aprobado*\nNro despacho: ${numeroDespacho}\nDespachado: ${cantDesp} und${saldoLinea}`
    );
  }

  return {
    despachado: cantDesp,
    numero_despacho: numeroDespacho
  };

    }     

    default:
      throw { status: 422, message: `No hay handler de aprobación para: ${accion}` };
  }
}

// ─────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.BUILDERBOT_ALLOWED_ORIGIN || 'https://app.builderbot.cloud');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuilderBot-Secret, X-Webhook-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    const msg = 'Metodo no permitido';
    return builderbotResponse(res, 200, { ok: false, message: msg, mensaje: msg, error: 'METHOD_NOT_ALLOWED' });
  }

  const rawBody = req.body || {};
  let info = parseBuilderBotInfo(rawBody);
  if (!info || typeof info !== 'object') info = {};

  try {
    requireBuilderBotAccess(req, info, rawBody);
  } catch (err) {
    const msg = err.status === 500
      ? 'Auth no configurada'
      : 'Webhook no autorizado';
    return builderbotResponse(res, 200, {
      ok: false,
      message: msg,
      mensaje: msg,
      error: err.message,
    });
  }

  const from     = rawBody.from || info.from || rawBody.number || info.number;
  let action     = info['@ction'] || info.action || rawBody['@ction'] || rawBody.action || 'UNKNOWN';
  let params     = info.params || {};
  const priority = info.priority || 'baja';
  const rawText  = getUserText(rawBody, info);
  const responseContext = {};

  if ((action === 'UNKNOWN' || action === 'accion_correspondiente') && rawText) {
    action = 'MODO_CHARLA';
    params = {
      ...params,
      texto: isGreeting(rawText)
        ? 'Hola. Soy el asistente del WMS. Puedo ayudarte con stock, recepcion, produccion, despachos, trazabilidad y aprobaciones. ¿Que necesitas?'
        : (params.texto || params.mensaje || params.message || 'No entendi tu mensaje. ¿Puedes ser mas especifico?'),
    };
  }

  // ── [FIX 17] Interceptor de lenguaje natural ──────────────
  // Si BuilderBot no pudo extraer una acción estructurada (UNKNOWN o
  // MODO_CHARLA), intentamos detectar aprobación/rechazo en el texto
  // libre del mensaje original antes de entrar al switch.
  if (action === 'UNKNOWN' || action === 'MODO_CHARLA') {
    const detectado = parsearAprobacionNatural(rawText);
    if (detectado) {
      console.log(`[webhook] 🔄 Redirigiendo "${action}" → "${detectado.action}" por lenguaje natural`);
      action = detectado.action;
      params = detectado.params;
    }
  }

  console.log(`[webhook] ▶ action="${action}" from="${from}" priority="${priority}"`);

  const db = await DB();
  try {
    await saveLog(db, { from, action, priority, payload: rawBody, response: null, status: 'RECEIVED' });

    const user     = await getOrCreateBotUser(db, from);

    // [FIX 20] Bloquear números no registrados antes de cualquier operación
    if (!user) {
      const msg = `⛔ Aún no eres parte del equipo GummyBox.\nContacta con un administrador para solicitar acceso.`;
      await saveLog(db, { from, action, priority, payload: rawBody, response: { error: 'UNREGISTERED_PHONE', mensaje: msg }, status: 'REJECTED' });
      // Retornar 200 para que BuilderBot Cloud pueda renderizar el mensaje en WhatsApp.
      // El 4xx impide que BBC lea el body y muestra el placeholder {mensaje} literal.
      return builderbotResponse(res, 200, { ok: false, message: msg, mensaje: msg, error: 'UNREGISTERED_PHONE' });
    }

    const bodegaId = await getDefaultBodega(db);

    params = normalizeOperationalParams(action, params);

    const cierreDetectado = parseProductionCloseInput(rawText);
    if (cierreDetectado && (action === 'UNKNOWN' || action === 'MODO_CHARLA' || action === 'CERRAR_ORDEN_PRODUCCION' || action === 'SOLICITAR_CIERRE_PRODUCCION')) {
      action = 'CERRAR_ORDEN_PRODUCCION';
      params = normalizeOperationalParams(action, {
        ...cierreDetectado.params,
        ...params,
        id_orden: firstDefined(cierreDetectado.params.id_orden, params.id_orden),
        cantidad_real: firstDefined(cierreDetectado.params.cantidad_real, params.cantidad_real),
        merma: firstDefined(cierreDetectado.params.merma, params.merma),
        motivo_merma: firstDefined(params.motivo_merma, cierreDetectado.params.motivo_merma),
        ubicacion: firstDefined(params.ubicacion, cierreDetectado.params.ubicacion),
        fecha_venc: firstDefined(params.fecha_venc, cierreDetectado.params.fecha_venc),
      });
    }

    if (action === 'CONSULTAR_TRAZABILIDAD_LOTE' && hasDispatchIntent(rawText)) {
      action = 'MODO_CHARLA';
      params = {
        texto: 'El despacho debe originarse en una factura de venta de Siigo. Puedo consultar nuevas facturas o confirmar una tarea de despacho existente.',
      };
    }

    const rolRaw = user.rol_nombre || '';
    const requiredCapability = capabilityForAction(action);
    if (requiredCapability && !hasCapability(rolRaw, requiredCapability)) {
      const msg = `🚫 No tienes permiso para ejecutar *${action}*.\nTu rol: ${rolRaw}`;
      await saveLog(db, { from, action, priority, payload: rawBody, response: { error: 'RBAC_DENIED' }, status: 'DENIED' });
      return builderbotResponse(res, 200, { ok: false, message: msg, mensaje: msg, error: 'RBAC_DENIED', rol: rolRaw });
    }

    let mensaje = '';

    switch (action) {

      // ── 1. INGRESO_RECEPCION ──────────────────────────────────
      case 'INGRESO_RECEPCION': {
        const p         = await findProductBySku(db, params.id_item);
        const numero    = await nextRecepcionNumero(db);
        const cantTotal = Number(params.cantidad) || 0;
        const cantMala  = Number(params.cantidad_mala) || 0;
        const cantBuena = cantTotal - cantMala;
        const lpnBuena  = `L-${p.siigo_code}-${Date.now()}`;

        const [recIns] = await db.execute(
          `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id)
           VALUES (?,?,?,'completada',?)`,
          [numero, bodegaId, params.proveedor || null, user.id]
        );
        const recepcionId = recIns.insertId;

        let lotIdBuena = null;
        if (cantBuena > 0) {
          lotIdBuena = await createLot(db, {
            lpn: lpnBuena, product_id: p.id, bodega_id: bodegaId,
            qty: cantBuena, supplier: params.proveedor || null,
            origin: 'RECEPCION', received_by: user.id,
          });
          await db.execute(
            `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
             VALUES (?,?,?,?,?)`,
            [recepcionId, p.id, lpnBuena, cantBuena, cantBuena]
          );
          await upsertStock(db, { producto_id: p.id, bodega_id: bodegaId, lote: lpnBuena, cantidad: cantBuena });
          await db.execute(
            `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
             VALUES ('entrada',?,?,?,?,?,'recepcion',?)`,
            [p.id, bodegaId, lpnBuena, cantBuena, recepcionId, user.id]
          );
          const balance = await getStockBalance(db, p.id, bodegaId);
          await logKardex(db, {
            product_id: p.id, user_id: user.id, action: 'INGRESO_RECEPCION',
            qty: cantBuena, lot_id: lotIdBuena, balance_after: balance,
            reference: `recepcion:${numero}`,
            notes: params.proveedor ? `Proveedor: ${params.proveedor}` : null,
          });
        }

        let msgMala = '';
        if (cantMala > 0) {
          const lpnNov   = `L-NOV-${p.siigo_code}-${Date.now()}`;
          const lotIdNov = await createLot(db, {
            lpn: lpnNov, product_id: p.id, bodega_id: bodegaId,
            qty: cantMala, supplier: params.proveedor || null,
            origin: 'RECEPCION', received_by: user.id, notes: 'Novedad en recepción',
          });
          await db.execute(
            `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
             VALUES (?,?,?,?,?)`,
            [recepcionId, p.id, lpnNov, cantMala, cantMala]
          );
          const balanceNov = await getStockBalance(db, p.id, bodegaId);
          await logKardex(db, {
            product_id: p.id, user_id: user.id, action: 'INGRESO_NOVEDAD',
            qty: cantMala, lot_id: lotIdNov, balance_after: balanceNov,
            reference: `recepcion:${numero}`,
            notes: `Cantidad con novedad — lote ${lpnNov}`,
          });
          msgMala = `\n⚠️ Novedad: ${cantMala} und → Lote ${lpnNov}`;
        }

        await logSystemEvent(db, { modulo: 'recepcion', nivel: 'INFO',
          mensaje: `Recepción ${numero} — ${cantBuena} buenas, ${cantMala} novedad`,
          usuario_id: user.id, payload: { numero, producto: params.id_item } });

        mensaje = [
          `✅ *Recepción registrada: ${numero}*`,
          `Producto: ${params.id_item}`,
          `Buenos: ${cantBuena} und → Lote ${lpnBuena}`,
          msgMala,
          params.proveedor ? `Proveedor: ${params.proveedor}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      // ── 2. SOLICITAR_INICIO_PRODUCCION ───────────────────────
      case 'SOLICITAR_INICIO_PRODUCCION': {
        const p        = await findProductBySku(db, params.id_producto_final);
        assertInternalProductionProduct(p);
        const cantPlan = Number(params.cantidad_planificada) || 0;

        const [bom] = await db.execute(
          `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
                  pr.siigo_code, pr.nombre
           FROM bom b
           JOIN productos pr ON pr.id = b.insumo_id
           WHERE b.producto_final_id = ? AND b.etapa = 'PRODUCCION'`, [p.id]
        ).catch(() => [[]]);

        const faltantes = [];
        const picking   = [];
        for (const item of bom) {
          const needed = roundQty(parseFloat(item.cantidad_por_unidad) * cantPlan);
          if (needed <= 0) continue;
          const [st] = await db.execute(
            `SELECT COALESCE(SUM(cantidad - reservada), 0) AS disponible
             FROM stock WHERE producto_id = ? AND bodega_id = ?`,
            [item.insumo_id, bodegaId]
          );
          const disponible = parseFloat(st[0]?.disponible || 0);
          const ok = disponible >= needed;
          picking.push(`  ${ok ? '✅' : '❌'} ${item.siigo_code} — ${item.nombre}: necesita ${needed}, disponible ${disponible} ${item.unidad}`);
          if (!ok) faltantes.push(`${item.siigo_code} (falta ${roundQty(needed - disponible)} ${item.unidad})`);
        }

        if (faltantes.length) {
          mensaje = [
            `❌ *No se puede iniciar producción de ${params.id_producto_final}*`,
            `Cantidad: ${cantPlan}`,
            ``, `📋 *Verificación de materiales:*`,
            ...picking,
            ``, `⚠️ *Faltantes:* ${faltantes.join(', ')}`
          ].join('\n');
          break;
        }

        const codigoOrden = await nextCodigoOrden(db);
        const [ins] = await db.execute(
          `INSERT INTO ordenes_produccion
             (codigo_orden, producto_id, cantidad_planeada, estado, creado_por, notas)
           VALUES (?,?,?,'PLANEADA',?,?)`,
          [codigoOrden, p.id, cantPlan, user.id,
           `Creada desde WhatsApp por ${from}`]
        );
        const orderId = ins.insertId;

        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_INICIO_PRODUCCION', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            order_id:       orderId,
            operario_phone: from,
          }), user.id]
        );

        const supPhones1 = await getSupervisorPhones(db);
        console.log(`[SOLICITAR_INICIO_PRODUCCION] supPhones=[${supPhones1.join(',')}] | solicitud="${codigo}" | orden="${codigoOrden}"`);
        let supervisorNotification1 = { ok: false };
        if (supPhones1.length) {
          const textoWA1 = [
            `🏭 *Solicitud de inicio de producción: ${codigo}*`,
            `Orden: ${codigoOrden}`,
            `Producto: ${params.id_producto_final} — ${cantPlan} uds`,
            `Solicitado por: ${user.nombre}`,
            ``, `📋 *Disponibilidad de materiales:*`,
            ...picking,
            ``,
            `Para aprobar responde: *apruebo ${codigo}*`,
            `Para rechazar responde: *rechazo ${codigo}*`
          ].join('\n');
          supervisorNotification1 = await notifySupervisorPhones(db, { phones: supPhones1, text: textoWA1, action: 'SOLICITAR_INICIO_PRODUCCION', codigo, userId: user.id });
          responseContext.notification = supervisorNotification1;
        } else {
          console.warn(`[SOLICITAR_INICIO_PRODUCCION] ⚠️  No hay supervisores activos — no se enviará WA.`);
        }

        await logSystemEvent(db, { modulo: 'produccion', nivel: 'INFO',
          mensaje: `Solicitud ${codigo} — inicio producción ${codigoOrden}`,
          usuario_id: user.id, payload: { codigo, codigoOrden, producto: params.id_producto_final } });

        mensaje = [
          `⏳ *Solicitud enviada: ${codigo}*`,
          `Orden creada: ${codigoOrden}`,
          `Producto: ${params.id_producto_final} — ${cantPlan} uds`,
          ``, `📋 *Disponibilidad verificada:*`,
          ...picking,
          ``, supervisorNotificationLine(supervisorNotification1)
        ].join('\n');
        break;
      }

      // ── 3. AVANCE_FASES ───────────────────────────────────────
      case 'AVANCE_FASES': {
        const [rows] = await db.execute(
          `SELECT id, codigo_orden, estado, fase FROM ordenes_produccion
           WHERE id = ? OR codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const orden = rows[0];

        if (orden.estado !== 'EN_PROCESO') {
          throw {
            status: 409,
            message: `La orden ${orden.codigo_orden} está en estado "${orden.estado}". Solo se pueden registrar avances de fase en órdenes EN_PROCESO.`,
          };
        }

        const faseAnterior = orden.fase || 'F0';
        await db.execute(
          `UPDATE ordenes_produccion
           SET fase  = ?,
               notas = CONCAT(IFNULL(notas,''), ?)
           WHERE id  = ?`,
          [
            params.fase_destino,
            `\nAvance ${faseAnterior} → ${params.fase_destino} — ${new Date().toISOString()}`,
            orden.id,
          ]
        );

        await logSystemEvent(db, {
          modulo: 'produccion', nivel: 'INFO',
          mensaje: `Orden ${orden.codigo_orden}: avance de fase ${faseAnterior} → ${params.fase_destino}`,
          usuario_id: user.id,
          payload: { orden_id: orden.id, codigo_orden: orden.codigo_orden, faseAnterior, faseDestino: params.fase_destino },
        });

        mensaje = `📦 *Avance registrado*\nOrden: ${orden.codigo_orden}\nFase: ${faseAnterior} → ${params.fase_destino}`;
        break;
      }

      // ── 4. REPORTE_MERMA ──────────────────────────────────────
      case 'REPORTE_MERMA': {
        const inferred = parseWasteReferences(rawText);
        const result = await reportWaste({ ...inferred, ...params }, user.id);
        mensaje = result.already_completed
          ? `La merma ${result.numero} ya estaba registrada. No se modifico inventario.`
          : [
              `Merma ${result.numero} registrada.`,
              `Referencia: ${result.referencia_externa}`,
              `Producto: ${result.sku}`,
              `Cantidad: ${result.cantidad}`,
              `Motivo: ${result.motivo}`,
              result.codigo_orden ? `Orden: ${result.codigo_orden}` : '',
              result.lote ? `Lote: ${result.lote}` : '',
              result.ubicacion ? `Ubicacion: ${result.ubicacion}` : '',
              result.balance_disponible != null
                ? `Disponible en bodega despues de la merma: ${result.balance_disponible}`
                : 'La merma de proceso quedo registrada para la conciliacion de la orden.',
            ].filter(Boolean).join('\n');
        break;
      }

      // ── 5. SOLICITAR_CIERRE_PRODUCCION → encolar ─────────────
      case 'SOLICITAR_CIERRE_PRODUCCION': {
        const [rows] = await db.execute(
          `SELECT * FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const orden = rows[0];

        if (['CERRADA','CANCELADA'].includes(orden.estado)) {
          throw { status: 409, message: `La orden ${orden.codigo_orden} ya está en estado "${orden.estado}" y no puede cerrarse nuevamente.` };
        }

        if (orden.estado !== 'EN_PROCESO') {
          throw {
            status: 409,
            message: orden.estado === 'APROBADA'
              ? `La orden ${orden.codigo_orden} esta APROBADA, pero aun no esta EN_PROCESO. Primero confirma materiales para descontar insumos; luego solicita el cierre.`
              : `La orden ${orden.codigo_orden} esta en estado "${orden.estado}" y debe estar EN_PROCESO para solicitar cierre.`
          };
        }

        const mermaDeclaradaRaw = params.merma ?? params.qty_waste ?? params.cantidad_merma ?? params.cantidad_no_conforme;
        if (mermaDeclaradaRaw == null) {
          throw { status: 400, message: 'Para cerrar produccion debes declarar la merma/no conforme, incluso si es 0.' };
        }
        const mermaDeclarada = Number(mermaDeclaradaRaw);
        if (!Number.isFinite(mermaDeclarada) || mermaDeclarada < 0) {
          throw { status: 400, message: 'La merma/no conforme debe ser un numero mayor o igual a 0.' };
        }
        if (mermaDeclarada > 0 && !(params.motivo_merma || params.motivo)) {
          const inferredReason =
            inferProductionCloseReasonFromText(rawText) ||
            await findRecentProductionCloseReason(db, from, orden.codigo_orden);
          if (inferredReason) {
            params.motivo_merma = inferredReason;
          }
        }
        if (mermaDeclarada > 0 && !(params.motivo_merma || params.motivo)) {
          const detalle = rawText
            ? 'Si hay merma de cierre, debes indicar el motivo.'
            : 'BuilderBot no envio motivo_merma ni el mensaje original en body/text/query. Ajusta el JSON del agente para incluir motivo_merma cuando merma > 0.';
          throw { status: 400, message: detalle };
        }
        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_CIERRE_PRODUCCION', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            order_id:       orden.id,
            codigo_orden:   orden.codigo_orden,
            qty_real:       params.cantidad_real != null ? params.cantidad_real : null,
            qty_waste:      mermaDeclarada,
            motivo_merma:   params.motivo_merma || params.motivo || null,
            operario_phone: from,
          }), user.id]
        );

        const supPhones2 = await getSupervisorPhones(db);
        console.log(`[SOLICITAR_CIERRE_PRODUCCION] supPhones=[${supPhones2.join(',')}] | solicitud="${codigo}" | orden="${orden.codigo_orden}"`);
        let supervisorNotification2 = { ok: false };
        if (supPhones2.length) {
          const cantPlan2  = parseFloat(orden.cantidad_planeada) || 0;
          const cantReal2  = params.cantidad_real != null ? parseFloat(params.cantidad_real) : cantPlan2;
          const merma2     = mermaDeclarada;
          const mermaLinea = merma2 > 0
            ? `📉 *Merma: ${merma2.toFixed(1)} und (${((merma2 / cantPlan2) * 100).toFixed(1)}%) — REQUIERE REVISIÓN*`
            : merma2 < 0
              ? `📈 Excedente: ${Math.abs(merma2).toFixed(1)} und sobre lo planeado`
              : `✅ Sin merma`;
          const textoWA2 = [
            `🏭 *Solicitud cierre de producción: ${codigo}*`,
            `Orden: ${orden.codigo_orden}`,
            `Estado actual: ${orden.estado}`,
            `Planeado: ${cantPlan2} und | Real: ${cantReal2} und`,
            mermaLinea,
            mermaDeclarada > 0 ? `Motivo merma: ${params.motivo_merma || params.motivo}` : '',
            `Operario: ${user.nombre}`,
            ``,
            `Para aprobar responde: *apruebo ${codigo}*`,
            `Para rechazar responde: *rechazo ${codigo}*`
          ].join('\n');
          supervisorNotification2 = await notifySupervisorPhones(db, { phones: supPhones2, text: textoWA2, action: 'SOLICITAR_CIERRE_PRODUCCION', codigo, userId: user.id });
          responseContext.notification = supervisorNotification2;
        } else {
          console.warn(`[SOLICITAR_CIERRE_PRODUCCION] ⚠️  No hay supervisores activos — no se enviará WA.`);
        }

        mensaje = [
          `⏳ *Solicitud enviada: ${codigo}*`,
          `Orden: ${orden.codigo_orden}`,
          `Cantidad real: ${params.cantidad_real ?? orden.cantidad_planeada}`,
          `Merma declarada: ${mermaDeclarada}`,
          supervisorNotificationLine(supervisorNotification2)
        ].join('\n');
        break;
      }

      // ── 6. SOLICITAR_DESPACHO → encolar (FIFO auto si no viene id_lote) ────
      case 'SOLICITAR_DESPACHO': {
        if (!workflowFlags().allowDirectDispatchRequest) {
          throw { status: 409, message: 'El despacho debe originarse en una factura de venta de Siigo. Consulta Siigo o confirma una tarea existente.' };
        }
        if (!params.id_item && params.id_lote) {
          const [lotProductRows] = await db.execute(
            `SELECT p.siigo_code
             FROM lots l
             JOIN productos p ON p.id = l.product_id
             WHERE l.lpn = ?
             LIMIT 1`,
            [params.id_lote]
          ).catch(() => [[]]);
          params.id_item = lotProductRows[0]?.siigo_code || null;
        }
        if (!params.id_item) throw { status: 400, message: 'id_item es obligatorio para SOLICITAR_DESPACHO' };
        const p = await findProductBySku(db, params.id_item);

        // FIFO auto-select: si el operario no especificó lote, tomamos el más antiguo disponible
        let lpnDespacho = params.id_lote || null;
        let fifoAuto    = false;
        if (!lpnDespacho) {
          const fifoLot = await findFifoLot(db, p.siigo_code, bodegaId);
          if (!fifoLot || !fifoLot.lpn) throw { status: 409, message: `Sin lote disponible para ${params.id_item}. El stock existe sin LPN o no hay lote FIFO disponible.` };
          const cantSol = Number(params.cantidad) || 0;
          if (cantSol > fifoLot.disponible) {
            throw { status: 409, message: `Stock insuficiente. Disponible en lote FIFO: ${fifoLot.disponible} und (${fifoLot.lpn})` };
          }
          lpnDespacho = fifoLot.lpn;
          fifoAuto    = true;
          console.log(`[SOLICITAR_DESPACHO] FIFO auto-seleccionado: lpn="${lpnDespacho}"`);
        }

        const lot    = await lotIdByLpn(db, lpnDespacho);
        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_DESPACHO', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            lot_id:         lot,
            lpn:            lpnDespacho,
            product_id:     p.id,
            qty:            params.cantidad,
            customer:       params.cliente_destino,
            operario_phone: from,
            fifo_auto:      fifoAuto,
          }), user.id]
        );

        const loteModo  = fifoAuto ? `${lpnDespacho} ⤵️ FIFO auto` : lpnDespacho;
        const supPhones3 = await getSupervisorPhones(db);
        console.log(`[SOLICITAR_DESPACHO] supPhones=[${supPhones3.join(',')}] | solicitud="${codigo}" | lote="${lpnDespacho}" | fifoAuto=${fifoAuto}`);
        let supervisorNotification3 = { ok: false };
        if (supPhones3.length) {
          const textoWA3 = [
            `📦 *Solicitud de despacho: ${codigo}*`,
            `Producto: ${params.id_item}`,
            `Lote: ${loteModo} — Cantidad: ${params.cantidad}`,
            `Cliente: ${params.cliente_destino || 'N/A'}`,
            ``,
            `Para aprobar responde: *apruebo ${codigo}*`,
            `Para rechazar responde: *rechazo ${codigo}*`
          ].join('\n');
          supervisorNotification3 = await notifySupervisorPhones(db, { phones: supPhones3, text: textoWA3, action: 'SOLICITAR_DESPACHO', codigo, userId: user.id });
          responseContext.notification = supervisorNotification3;
        } else {
          console.warn(`[SOLICITAR_DESPACHO] ⚠️  No hay supervisores activos — no se enviará WA.`);
        }

        const lpnCortoDisp = lpnDespacho && lpnDespacho.length > 30
          ? lpnDespacho.slice(0, 30) + '…'
          : lpnDespacho;
        mensaje = [
          `⏳ *Solicitud de despacho: ${codigo}*`,
          `Producto: ${params.id_item}`,
          `Lote: ${lpnCortoDisp}${fifoAuto ? ' (FIFO auto)' : ''}`,
          `Cantidad: ${params.cantidad}`,
          supervisorNotificationLine(supervisorNotification3)
        ].join('\n');
        break;
      }

      // ── 7. GESTION_DEVOLUCION ─────────────────────────────────
      case 'GESTION_DEVOLUCION': {
        const returned = await createCustomerReturn({
          ...parseCustomerReturnReferences(rawText),
          ...params,
        }, user.id);
        mensaje = returned.already_completed
          ? `La devolucion ${returned.numero} ya estaba registrada. No se modifico inventario.`
          : [
              `Devolucion ${returned.numero} registrada.`,
              `Referencia: ${returned.referencia_externa}`,
              `Factura: ${returned.siigo_invoice_name}`,
              `Despacho: ${returned.despacho_numero}`,
              `Cliente: ${returned.cliente_origen}`,
              `Producto: ${returned.sku}`,
              `Cantidad: ${returned.cantidad}`,
              `Lote origen: ${returned.lote_origen}`,
              `Nuevo lote: ${returned.lote}`,
              `Ubicacion: ${returned.ubicacion}`,
              `Destino: ${returned.destino}`,
            ].join('\n');
        responseContext.return = returned;
        break;
      }

      // ── 8. APROBAR_SOLICITUD ──────────────────────────────────
      case 'APROBAR_SOLICITUD': {
        let solicitud;
        let execResult;
        await db.beginTransaction();
        try {
        const [rows] = await db.execute(
          `SELECT * FROM aprobaciones WHERE codigo_solicitud = ? AND estado = 'PENDIENTE' LIMIT 1 FOR UPDATE`,
          [params.id_solicitud]
        );
        if (!rows.length) {
          // Solicitud ya procesada: buscar quién la procesó
          const [proc] = await db.execute(
            `SELECT a.estado, a.procesado_en, a.motivo_rechazo,
                    u.nombre AS procesado_nombre
             FROM aprobaciones a
             LEFT JOIN usuarios u ON u.id = a.procesado_por
             WHERE a.codigo_solicitud = ? LIMIT 1`,
            [params.id_solicitud]
          );
          if (proc.length) {
            const p      = proc[0];
            const quien  = p.procesado_nombre || 'otro supervisor';
            const cuando = p.procesado_en
              ? new Date(p.procesado_en).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' })
              : '';
            const label  = p.estado === 'APROBADO' ? '✅ aprobada' : p.estado === 'RECHAZADO' ? '❌ rechazada' : p.estado;
            const motivo = p.motivo_rechazo ? `\nMotivo: ${p.motivo_rechazo}` : '';
            throw { status: 409, message: `${params.id_solicitud} ya fue ${label} por ${quien}${cuando ? ` el ${cuando}` : ''}${motivo}` };
          }
          throw { status: 404, message: `Solicitud ${params.id_solicitud} no encontrada` };
        }
        solicitud = rows[0];
        const payload   = typeof solicitud.payload === 'string'
          ? JSON.parse(solicitud.payload) : solicitud.payload;
        console.log(`[APROBAR_SOLICITUD] Procesando solicitud="${params.id_solicitud}" accion="${solicitud.accion}"`);
        execResult = await executeApprovedPayload(db, {
          accion: solicitud.accion, payload, aprobador_id: user.id, bodegaId,
        });
        const [approvalUpdate] = await db.execute(
          `UPDATE aprobaciones SET estado='APROBADO', procesado_por=?, procesado_en=NOW() WHERE codigo_solicitud=? AND estado='PENDIENTE'`,
          [user.id, params.id_solicitud]
        );
        if (approvalUpdate.affectedRows !== 1) {
          throw { status: 409, message: 'La solicitud cambio de estado durante la aprobacion' };
        }
        await logSystemEvent(db, { modulo: 'aprobaciones', nivel: 'INFO',
          mensaje: `Solicitud ${params.id_solicitud} aprobada`,
          usuario_id: user.id, payload: execResult });
        await db.commit();
        } catch (err) {
          try { await db.rollback(); } catch (_) {}
          throw err;
        }
        mensaje = [
          `✅ *${params.id_solicitud} Aprobada*`,
          `Acción: ${solicitud.accion.replace(/_/g,' ')}`,
          [
            execResult?.orden ? `Orden: ${execResult.orden}` : '',
            execResult?.estado ? `Estado: ${execResult.estado}` : '',
            execResult?.numero_despacho ? `Despacho: ${execResult.numero_despacho}` : '',
            execResult?.despachado ? `Cantidad despachada: ${execResult.despachado} und` : '',
            execResult?.lote ? `Lote: ${execResult.lote}` : '',
            execResult?.cantidad ? `Cantidad: ${execResult.cantidad} und` : '',
            execResult?.reservados != null ? `Materiales reservados: ${execResult.reservados}` : '',
            ...(Array.isArray(execResult?.lotes) ? execResult.lotes.map(l => `Lote ${l.lpn}: ${l.qty} und${l.saldo_lote != null ? ` | saldo ${l.saldo_lote}` : ''}`) : [])
          ].filter(Boolean).join('\n')
        ].join('\n');
        break;
      }

      // ── 9. RECHAZAR_SOLICITUD ─────────────────────────────────
      case 'RECHAZAR_SOLICITUD': {
        const [rows] = await db.execute(
          `SELECT * FROM aprobaciones WHERE codigo_solicitud = ? AND estado = 'PENDIENTE' LIMIT 1`,
          [params.id_solicitud]
        );
        if (!rows.length) {
          // Solicitud ya procesada: buscar quién la procesó
          const [proc] = await db.execute(
            `SELECT a.estado, a.procesado_en, a.motivo_rechazo,
                    u.nombre AS procesado_nombre
             FROM aprobaciones a
             LEFT JOIN usuarios u ON u.id = a.procesado_por
             WHERE a.codigo_solicitud = ? LIMIT 1`,
            [params.id_solicitud]
          );
          if (proc.length) {
            const p      = proc[0];
            const quien  = p.procesado_nombre || 'otro supervisor';
            const cuando = p.procesado_en
              ? new Date(p.procesado_en).toLocaleString('es-CO', { dateStyle:'short', timeStyle:'short' })
              : '';
            const label  = p.estado === 'APROBADO' ? '✅ aprobada' : p.estado === 'RECHAZADO' ? '❌ rechazada' : p.estado;
            const motivo = p.motivo_rechazo ? `\nMotivo: ${p.motivo_rechazo}` : '';
            throw { status: 409, message: `${params.id_solicitud} ya fue ${label} por ${quien}${cuando ? ` el ${cuando}` : ''}${motivo}` };
          }
          throw { status: 404, message: `Solicitud ${params.id_solicitud} no encontrada` };
        }
        const payload = typeof rows[0].payload === 'string'
          ? JSON.parse(rows[0].payload) : rows[0].payload;
        await db.execute(
          `UPDATE aprobaciones SET estado='RECHAZADO', procesado_por=?, procesado_en=NOW(),
           motivo_rechazo=? WHERE codigo_solicitud=?`,
          [user.id, params.motivo || null, params.id_solicitud]
        );
        if (payload?.operario_phone) {
          await pushWA(
            payload.operario_phone,
            [
              `❌ *Solicitud ${params.id_solicitud} RECHAZADA*`,
              params.motivo ? `Motivo: ${params.motivo}` : ''
            ].filter(Boolean).join('\n')
          );
        }
        await logSystemEvent(db, { modulo: 'aprobaciones', nivel: 'WARN',
          mensaje: `Solicitud ${params.id_solicitud} rechazada`,
          usuario_id: user.id, payload: { motivo: params.motivo } });
        mensaje = [
          `❌ *${params.id_solicitud} Rechazada*`,
          params.motivo ? `Motivo: ${params.motivo}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      // ── 10. AJUSTE_INVENTARIO ─────────────────────────────────
      case 'AJUSTE_INVENTARIO': {
        const p    = await findProductBySku(db, params.id_item);
        const diff = Number(params.cantidad);
        if (!Number.isFinite(diff) || diff === 0) {
          throw { status: 400, message: 'AJUSTE_INVENTARIO requiere cantidad numerica distinta de cero' };
        }
        const lotIdAjuste = await lotIdByLpn(db, params.id_lote);
        if (params.id_lote) {
          const needed = Math.abs(Math.min(diff, 0));
          const [stockUpdate] = await db.execute(
            `UPDATE stock
             SET cantidad = cantidad + ?
             WHERE producto_id=? AND lote=? AND (? >= 0 OR cantidad >= ?)`,
            [diff, p.id, params.id_lote, diff, needed]
          );
          if (stockUpdate.affectedRows !== 1) {
            throw { status: 409, message: `Stock insuficiente para ajustar lote ${params.id_lote}` };
          }
          const [lotUpdate] = await db.execute(
            `UPDATE lots
             SET qty_current = qty_current + ?
             WHERE lpn = ? AND (? >= 0 OR qty_current >= ?)`,
            [diff, params.id_lote, diff, needed]
          );
          if (lotUpdate.affectedRows !== 1) {
            throw { status: 409, message: `Lote insuficiente para ajuste ${params.id_lote}` };
          }
          await db.execute(
            `UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE') WHERE lpn = ?`,
            [params.id_lote]
          );
        } else {
          const needed = Math.abs(Math.min(diff, 0));
          const [stockUpdate] = await db.execute(
            `UPDATE stock
             SET cantidad = cantidad + ?
             WHERE producto_id=? AND bodega_id=? AND (? >= 0 OR cantidad >= ?)
             ORDER BY id ASC LIMIT 1`,
            [diff, p.id, bodegaId, diff, needed]
          );
          if (stockUpdate.affectedRows !== 1) {
            throw { status: 409, message: `Stock insuficiente para ajustar ${params.id_item}` };
          }
        }
        await db.execute(
          `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
           VALUES ('ajuste',?,?,?,?,'ajuste_manual',?)`,
          [p.id, bodegaId, params.id_lote || null, diff, user.id]
        );
        const balance = await getStockBalance(db, p.id, bodegaId);
        await logKardex(db, {
          product_id: p.id, user_id: user.id, action: 'AJUSTE_MANUAL',
          qty: diff, lot_id: lotIdAjuste, balance_after: balance,
          reference: params.id_lote ? `lote:${params.id_lote}` : null,
          notes: params.motivo || null,
        });
        await logSystemEvent(db, { modulo: 'inventario', nivel: 'WARN',
          mensaje: `Ajuste manual: ${diff > 0 ? '+' : ''}${diff} und de ${params.id_item}`,
          usuario_id: user.id, payload: { producto: params.id_item, diff, lote: params.id_lote } });
        mensaje = [
          `🔧 *Ajuste registrado*`,
          `Producto: ${params.id_item}`,
          `Ajuste: ${diff > 0 ? '+' : ''}${diff} und`,
          `Saldo nuevo: ${balance} und`,
          params.motivo ? `Motivo: ${params.motivo}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      // ── 11. CONSULTAR_SOLICITUDES_PENDIENTES ──────────────────
      case 'CONSULTAR_SOLICITUDES_PENDIENTES': {
        const [rows] = await db.execute(
          `SELECT a.codigo_solicitud, a.accion, a.payload, a.creado_en, u.nombre AS operario
           FROM aprobaciones a
           LEFT JOIN usuarios u ON u.id = a.solicitado_por
           WHERE a.estado = 'PENDIENTE'
           ORDER BY a.creado_en ASC LIMIT 10`
        );
        mensaje = formatPendingApprovals(rows);
        break;
      }

      case 'SINCRONIZAR_FACTURAS_SIIGO': {
        const syncResult = await triggerInvoiceImport();
        const rows = Array.isArray(syncResult.results) ? syncResult.results : [];
        const created = rows.filter(row => ['created', 'updated', 'converted'].includes(row.status));
        const pending = rows.filter(row => ['pending_customer'].includes(row.status) || (row.shortages || []).length > 0);
        const errors = rows.filter(row => row.status === 'error');
        mensaje = [
          'Consulta de facturas Siigo completada.',
          `Tareas creadas o actualizadas: ${created.length}`,
          `Pendientes de datos o stock: ${pending.length}`,
          `Errores: ${errors.length}`,
        ].join('\n');
        responseContext.siigo = { created: created.length, pending: pending.length, errors: errors.length };
        break;
      }

      case 'LIBERAR_ORDEN_PRODUCCION': {
        const productionResult = await releaseProductionOrder({
          product: params.id_producto_final || params.id_item || params.sku,
          quantity: params.cantidad_planificada || params.cantidad,
          originType: params.origen_tipo,
          customerReference: params.referencia_cliente || params.oc_cliente,
          finalCustomer: params.cliente_final,
          notes: params.notas || params.observaciones,
          userId: user.id,
        });
        const picking = productionResult.picking.map(item =>
          `- ${item.sku}: ${item.cantidad} ${item.unidad || ''} | lote ${item.lote} | ubicacion ${item.ubicacion || item.ubicacion_id}`
        );
        mensaje = [
          `Orden ${productionResult.order_code} liberada.`,
          `Destino: ${productionResult.origin_type === 'OC_CLIENTE' ? `OC ${productionResult.customer_reference} - ${productionResult.final_customer}` : 'stock de seguridad'}`,
          'Alistamiento FEFO:',
          ...picking,
          `Cuando esten listos, confirma materiales de ${productionResult.order_code}.`,
        ].join('\n');
        responseContext.production = productionResult;
        break;
      }

      case 'CERRAR_ORDEN_PRODUCCION': {
        const closure = await closeProductionOrder({
          orderId: params.id_orden,
          qtyReal: params.cantidad_real,
          qtyWaste: params.merma,
          wasteReason: params.motivo_merma,
          locationId: params.ubicacion_id,
          locationCode: params.ubicacion,
          expiryDate: params.fecha_venc,
          userId: user.id,
        });
        const closedWhen = closure.closed_at
          ? new Date(closure.closed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' })
          : null;
        mensaje = closure.already_closed
          ? `La orden ${closure.order_code} ya estaba cerrada${closure.closed_by ? ` por ${closure.closed_by}` : ''}${closedWhen ? ` el ${closedWhen}` : ''}. No se modifico inventario.`
          : [
              `Orden ${closure.order_code} cerrada.`,
              `Producto conforme: ${closure.qty_real}`,
              `Merma: ${closure.qty_waste}`,
              `Lote PT: ${closure.lpn_terminado}`,
              `Ubicacion: ${closure.ubicacion || closure.ubicacion_id}`,
            ].join('\n');
        responseContext.production_close = closure;
        break;
      }

      case 'CONFIRMAR_DESPACHO_SIIGO': {
        const dispatchResult = await confirmImportedDispatch({
          dispatchId: params.despacho_id || params.id_despacho,
          invoiceId: params.siigo_invoice_id || params.id_factura,
          userId: user.id,
        });
        const lots = (dispatchResult.lotes || []).map(item =>
          `- ${item.sku}: ${item.cantidad} und del lote ${item.lote}`
        );
        mensaje = dispatchResult.already_completed
          ? `El despacho ${dispatchResult.numero} ya habia sido confirmado. No se modifico inventario.`
          : [
              `Despacho ${dispatchResult.numero} confirmado.`,
              `Factura: ${dispatchResult.siigo_invoice_name || dispatchResult.siigo_invoice_id}`,
              ...lots,
            ].join('\n');
        responseContext.dispatch = dispatchResult;
        break;
      }

      case 'AJUSTAR_MATERIALES_PRODUCCION': {
        const adjustment = await adjustProductionMaterials({
          orderId: params.id_orden,
          productTerm: params.id_item || params.sku,
          lot: params.id_lote || params.lote,
          locationId: params.ubicacion_id,
          locationCode: params.ubicacion,
          type: params.tipo,
          quantity: params.cantidad,
          reason: params.motivo,
          userId: user.id,
        });
        mensaje = `${adjustment.tipo} registrada en ${adjustment.order_code}: ${adjustment.cantidad} de ${adjustment.sku}, lote ${adjustment.lote}, ubicacion ${adjustment.ubicacion || adjustment.ubicacion_id}.`;
        responseContext.production_material = adjustment;
        break;
      }

      // ── Consultas de stock ────────────────────────────────────
      case 'CONSULTAR_STOCK_MATERIA_PRIMA':
      case 'CONSULTAR_STOCK_PRODUCTO_TERMINADO': {
        const tipoFiltro = action === 'CONSULTAR_STOCK_MATERIA_PRIMA' ? 'MP' : 'PT';
        const label      = tipoFiltro === 'MP' ? 'Materia Prima' : 'Producto Terminado';

        const [bodegaRow] = await db.execute(
          `SELECT codigo FROM bodegas WHERE id = ? LIMIT 1`, [bodegaId]
        );
        const bodegaCodigo = bodegaRow[0]?.codigo || 'BG-PPAL';

        const result = await queryStockDisponible(db, {
          sku: params.id_item || null,
          bodega: bodegaCodigo,
          tipoFiltro,
        });

        if (params.id_item) {
          const totalDisp = result.rows.reduce((s, r) => s + parseFloat(r.disponible || 0), 0);
          if (!result.rows.length) {
            mensaje = `📊 *Stock: ${params.id_item}*\n  Sin stock disponible`;
          } else {
            // [FIX 22] Separar lotes por estado: vencidos, cuarentena, disponibles
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const lotesVencidosInfo = [];
            const lotesCuarentenaInfo = [];
            const lotesDispLines = [];
            let totalNeto = 0;

            for (const r of result.rows) {
              const disp = parseFloat(r.disponible || 0);
              const lpnCorto = r.lote && r.lote.length > 26 ? r.lote.slice(0, 26) + '…' : (r.lote || 'sin lote');

              // 1) Vencido por fecha
              if (r.vence) {
                const fv = new Date(r.vence); fv.setHours(0, 0, 0, 0);
                if (fv < hoy) {
                  lotesVencidosInfo.push({ lpnCorto, disp, fecha: fv.toLocaleDateString('es-CO') });
                  continue;
                }
              }
              // 2) En cuarentena por estado_lote
              if (r.estado_lote === 'CUARENTENA') {
                lotesCuarentenaInfo.push({ lpnCorto, disp });
                continue;
              }
              // 3) Disponible real
              const venceStr = r.vence ? ` (vence ${new Date(r.vence).toLocaleDateString('es-CO')})` : '';
              lotesDispLines.push(`  • ${lpnCorto}: *${disp} und*${venceStr}`);
              totalNeto += disp;
            }

            const secDisp = lotesDispLines.length
              ? [`📦 *Lotes FIFO:*`, ...lotesDispLines].join('\n')
              : `📦 *Lotes FIFO:*\n  (Sin lotes disponibles)`;

            const secCuarentena = lotesCuarentenaInfo.length
              ? `\n⚠️ *En cuarentena (${lotesCuarentenaInfo.length} lote${lotesCuarentenaInfo.length > 1 ? 's' : ''}):*\n`
                + lotesCuarentenaInfo.map(l => `  🔒 ${l.lpnCorto}: *${l.disp} und*`).join('\n')
                + `\n_No disponible para despacho. Requiere aprobación._`
              : '';

            const secVencidos = lotesVencidosInfo.length
              ? `\n⛔ *ALERTA — ${lotesVencidosInfo.length} lote${lotesVencidosInfo.length > 1 ? 's' : ''} VENCIDO${lotesVencidosInfo.length > 1 ? 'S' : ''}:*\n`
                + lotesVencidosInfo.map(l => `  ❌ ${l.lpnCorto} 🚨 *VENCIÓ ${l.fecha}*`).join('\n')
                + `\n_Requiere disposición inmediata. Notifica al supervisor._`
              : '';

            mensaje = [
              `📊 *Stock ${label}: ${params.id_item}*`,
              `Total disponible: *${totalNeto} und*`,
              ``,
              secDisp,
              secCuarentena,
              secVencidos
            ].filter(Boolean).join('\n');
          }
        } else {
          const lines = result.rows.length
            ? result.rows.map(r => `  • ${r.sku}: *${parseFloat(r.total)} und*`).join('\n')
            : '  (Sin stock registrado)';
          mensaje = `📦 *Stock ${label} — Top 10:*\n${lines}`;
        }
        break;
      }

      // ── Consulta estado de orden ──────────────────────────────
      case 'CONSULTAR_ESTADO_PRODUCCION': {
        const [rows] = await db.execute(
          `SELECT o.id, o.codigo_orden, o.estado, o.fase,
                  o.cantidad_planeada, o.cantidad_real,
                  o.creado_en, o.cerrado_en,
                  p.nombre AS producto, p.siigo_code
           FROM ordenes_produccion o
           JOIN productos p ON p.id = o.producto_id
           WHERE o.id = ? OR o.codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const o = rows[0];
        mensaje = [
          `🔍 *Orden: ${o.codigo_orden || o.id}*`,
          `Producto: ${o.producto} (${o.siigo_code})`,
          `Estado: ${o.estado}  |  Fase: ${o.fase || 'F0'}`,
          `Planeado: ${o.cantidad_planeada} und`,
          `Producido: ${o.cantidad_real > 0 ? o.cantidad_real + ' und' : 'En proceso'}`,
          o.cerrado_en ? `Cerrado: ${new Date(o.cerrado_en).toLocaleDateString('es-CO')}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      // ── Trazabilidad de lote ──────────────────────────────────
      case 'CONSULTAR_TRAZABILIDAD_LOTE': {
  const [lotRows] = await db.execute(
    `SELECT l.*, p.nombre, p.siigo_code
     FROM lots l
     JOIN productos p ON p.id = l.product_id
     WHERE l.lpn = ?
     LIMIT 1`,
    [params.id_lote]
  ).catch(() => [[]]);

  if (lotRows.length) {
    const l = lotRows[0];

    const [kRows] = await db.execute(
      `SELECT
         k.action,
         k.qty,
         k.balance_after,
         k.reference,
         k.notes,
         k.created_at,
         (SELECT u.codigo
          FROM lots kl
          JOIN stock ks ON ks.lote = kl.lpn
          JOIN ubicaciones u ON u.id = ks.ubicacion_id
          WHERE kl.id = k.lot_id
          ORDER BY ks.id LIMIT 1) AS ubicacion_codigo,
         dv.cantidad AS cantidad_fisica_devolucion,
         dv.estado AS estado_devolucion
       FROM kardex k
       LEFT JOIN devoluciones dv ON k.reference = CONCAT('devolucion:', dv.numero)
       WHERE k.lot_id = ?
       ORDER BY k.created_at ASC`,
      [l.id]
    ).catch(() => [[]]);

    const history = kRows.length
      ? kRows.map(k => {
          const fecha = new Date(k.created_at).toLocaleString('es-CO');
          if (k.action === 'DEVOLUCION'
              && Number(k.qty) === 0
              && Number(k.cantidad_fisica_devolucion) > 0) {
            return `  ${fecha} | DEVOLUCION_${k.estado_devolucion}: ${k.cantidad_fisica_devolucion} und fisicas (sin cambio en disponible; saldo: ${k.balance_after})${k.notes ? ` | ${k.notes}` : ''}`;
          }
          let extra = '';

          if (k.action === 'CIERRE_PRODUCCION' && k.ubicacion_codigo) {
            extra = ` | Ubicacion ${k.ubicacion_codigo}`;
          } else if (k.notes) {
            extra = ` | ${k.notes}`;
          }

          return `  ${fecha} | ${k.action}: ${k.qty > 0 ? '+' : ''}${k.qty} (saldo: ${k.balance_after})${extra}`;
        }).join('\n')
      : '  (Sin movimientos en kardex)';

    const [dispatchRows] = await db.execute(
      `SELECT d.numero, d.cliente_nombre, d.siigo_invoice_name, d.despachado_en, di.cantidad_des AS cantidad
       FROM despacho_items di
       JOIN despachos d ON d.id = di.despacho_id
       WHERE di.lote = ? AND d.estado = 'despachado' AND di.cantidad_des > 0
       ORDER BY COALESCE(d.despachado_en, d.creado_en) ASC
       LIMIT 10`,
      [params.id_lote]
    ).catch(() => [[]]);
    const dispatchHistory = dispatchRows.length
      ? dispatchRows.map(d => `  - ${d.numero} / ${d.siigo_invoice_name || 'sin factura'}: ${d.cantidad} und -> ${d.cliente_nombre || 'Cliente N/A'} (${d.despachado_en ? new Date(d.despachado_en).toLocaleString('es-CO') : 'sin fecha'})`).join('\n')
      : l.origin === 'DEVOLUCION'
        ? '  (Este lote devuelto no registra despachos posteriores)'
        : '  (Sin despachos registrados)';

    const [returnRows] = await db.execute(
      `SELECT dv.numero, dv.referencia_externa, dv.cliente_origen, dv.cantidad,
              dv.estado, dv.lote, dv.lote_origen, dv.creado_en,
              d.numero AS despacho_numero, d.siigo_invoice_name,
              u.codigo AS ubicacion
       FROM devoluciones dv
       LEFT JOIN despachos d ON d.id = dv.despacho_id
       LEFT JOIN ubicaciones u ON u.id = dv.ubicacion_id
       WHERE dv.lote = ? OR dv.lote_origen = ?
       ORDER BY dv.creado_en ASC
       LIMIT 10`,
      [params.id_lote, params.id_lote]
    ).catch(() => [[]]);
    const returnHistory = returnRows.length
      ? returnRows.map(d => [
          `  - ${d.numero} / ${d.referencia_externa || 'sin referencia'}: ${d.cantidad} und | ${d.estado}`,
          `    ${d.lote_origen || 'lote origen N/A'} -> ${d.lote || 'lote devuelto N/A'} | ${d.ubicacion || 'sin ubicacion'}`,
          `    ${d.despacho_numero || 'sin despacho'} / ${d.siigo_invoice_name || 'sin factura'} -> ${d.cliente_origen || 'Cliente N/A'}`,
        ].join('\n')).join('\n')
      : '  (Sin devoluciones registradas)';

    const [bomRows] = await db.execute(
      `SELECT i.siigo_code, i.nombre, b.cantidad_por_unidad, b.unidad
       FROM bom b
       JOIN productos i ON i.id = b.insumo_id
       WHERE b.producto_final_id = ?
       ORDER BY i.siigo_code ASC
       LIMIT 12`,
      [l.product_id]
    ).catch(() => [[]]);
    const bomHistory = bomRows.length
      ? bomRows.map(b => `  - ${b.siigo_code}: ${b.cantidad_por_unidad} ${b.unidad}/und`).join('\n')
      : '  (Sin BOM registrado para este producto)';

    const [receptionRows] = await db.execute(
      `SELECT numero, siigo_purchase_name, proveedor_nombre, orden_compra,
              condicion, cantidad, ubicacion
       FROM (
         SELECT r.numero, r.siigo_purchase_name, r.proveedor_nombre,
                oc.numero AS orden_compra, rd.condicion, rd.cantidad,
                u.codigo AS ubicacion, rd.creado_en AS evento
         FROM recepcion_distribuciones rd
         JOIN recepciones r ON r.id = rd.recepcion_id
         LEFT JOIN ordenes_compra_proveedor oc ON oc.id = r.orden_compra_id
         LEFT JOIN ubicaciones u ON u.id = rd.ubicacion_id
         WHERE rd.lote = ?
         UNION ALL
         SELECT r.numero, r.siigo_purchase_name, r.proveedor_nombre,
                NULL AS orden_compra, CONCAT('DEVOLUCION_', dv.estado) AS condicion,
                dv.cantidad, u.codigo AS ubicacion, dv.creado_en AS evento
         FROM devoluciones dv
         JOIN recepciones r ON r.id = dv.recepcion_id
         LEFT JOIN ubicaciones u ON u.id = dv.ubicacion_id
         WHERE dv.lote = ?
       ) origen
       ORDER BY evento ASC`,
      [params.id_lote, params.id_lote]
    ).catch(() => [[]]);
    const receptionHistory = receptionRows.length
      ? receptionRows.map(r => `  - ${r.numero} | OC ${r.orden_compra || 'N/A'} | Siigo ${r.siigo_purchase_name || 'N/A'} | ${r.proveedor_nombre || 'Proveedor N/A'} | ${r.condicion} ${r.cantidad} | ${r.ubicacion || 'sin ubicacion'}`).join('\n')
      : '  (Sin recepcion vinculada)';

    const [materialRows] = l.production_order_id ? await db.execute(
      `SELECT p.siigo_code, p.nombre, pml.lote, u.codigo AS ubicacion,
              pml.cantidad_consumida, pml.cantidad_devuelta,
              (SELECT COALESCE(SUM(m.cantidad), 0) FROM mermas m
               WHERE m.orden_produccion_id = pm.orden_produccion_id
                 AND m.producto_id = pm.producto_id) AS merma_proceso,
              ol.supplier, rr.siigo_purchase_name, oc.numero AS orden_compra
       FROM produccion_materiales pm
       JOIN produccion_material_lotes pml ON pml.produccion_material_id = pm.id
       JOIN productos p ON p.id = pm.producto_id
       LEFT JOIN ubicaciones u ON u.id = pml.ubicacion_id
       LEFT JOIN lots ol ON ol.lpn = pml.lote
       LEFT JOIN recepcion_distribuciones rd ON rd.lote = pml.lote
       LEFT JOIN recepciones rr ON rr.id = rd.recepcion_id
       LEFT JOIN ordenes_compra_proveedor oc ON oc.id = rr.orden_compra_id
       WHERE pm.orden_produccion_id = ? ORDER BY pm.id, pml.id`,
      [l.production_order_id]
    ).catch(() => [[]]) : [[]];
    const materialHistory = materialRows.length
      ? materialRows.map(m => {
          const net = Number(m.cantidad_consumida || 0) - Number(m.cantidad_devuelta || 0);
          const processWaste = Number(m.merma_proceso || 0);
          return `  - ${m.siigo_code}: lote ${m.lote}, ubicacion ${m.ubicacion || 'N/A'}, neto entregado ${net}, merma proceso ${processWaste}, uso productivo estimado ${Number((net - processWaste).toFixed(4))} | OC ${m.orden_compra || 'N/A'} | Siigo ${m.siigo_purchase_name || 'N/A'} | ${m.supplier || 'proveedor N/A'}`;
        }).join('\n')
      : '  (Sin consumo real de materiales registrado)';

    const [productionRows] = l.production_order_id ? await db.execute(
      `SELECT op.codigo_orden, op.estado, op.cantidad_planeada, op.cantidad_real,
              op.cerrado_en, u.nombre AS cerrado_por
       FROM ordenes_produccion op
       LEFT JOIN usuarios u ON u.id = op.aprobado_por
       WHERE op.id = ? LIMIT 1`,
      [l.production_order_id]
    ).catch(() => [[]]) : [[]];
    const productionHistory = productionRows.length
      ? productionRows.map(op => `  - ${op.codigo_orden} | ${op.estado} | plan ${op.cantidad_planeada} | conformes ${op.cantidad_real} | cerro ${op.cerrado_por || 'N/A'} | ${op.cerrado_en ? new Date(op.cerrado_en).toLocaleString('es-CO') : 'sin cierre'}`).join('\n')
      : '  (Sin orden de produccion vinculada)';

    const [wasteRows] = l.production_order_id ? await db.execute(
      `SELECT m.numero, p.siigo_code, m.cantidad, m.motivo,
              m.referencia_externa, m.creado_en
       FROM mermas m JOIN productos p ON p.id = m.producto_id
       WHERE m.orden_produccion_id = ? ORDER BY m.creado_en, m.id`,
      [l.production_order_id]
    ).catch(() => [[]]) : [[]];
    const wasteHistory = wasteRows.length
      ? wasteRows.map(m => `  - ${m.numero}: ${m.siigo_code} | ${m.cantidad} und | ${m.motivo || 'sin motivo'} | ${m.referencia_externa ? `proceso ${m.referencia_externa}` : 'cierre de produccion'}`).join('\n')
      : '  (Sin mermas asociadas)';

    const [productionUseRows] = await db.execute(
      `SELECT op.codigo_orden, pt.siigo_code AS producto_final,
              pml.cantidad_consumida, pml.cantidad_devuelta,
              (SELECT COALESCE(SUM(m.cantidad), 0) FROM mermas m
               WHERE m.orden_produccion_id = op.id
                 AND m.producto_id = pm.producto_id) AS merma_proceso
       FROM produccion_material_lotes pml
       JOIN produccion_materiales pm ON pm.id = pml.produccion_material_id
       JOIN ordenes_produccion op ON op.id = pm.orden_produccion_id
       JOIN productos pt ON pt.id = op.producto_id
       WHERE pml.lote = ? ORDER BY op.creado_en ASC`,
      [params.id_lote]
    ).catch(() => [[]]);
    const productionUses = productionUseRows.length
      ? productionUseRows.map(p => {
          const net = Number(p.cantidad_consumida || 0) - Number(p.cantidad_devuelta || 0);
          const processWaste = Number(p.merma_proceso || 0);
          return `  - ${p.codigo_orden} -> ${p.producto_final}: neto entregado ${net}, merma proceso ${processWaste}, uso productivo estimado ${Number((net - processWaste).toFixed(4))}`;
        }).join('\n')
      : '  (No consumido en produccion)';

    mensaje = [
      `🔎 *Lote: ${params.id_lote}*`,
      `Producto: ${l.nombre} (${l.siigo_code})`,
      l.notes ? `Referencia: ${l.notes}` : '',
      `Inicial: ${l.qty_initial} und`,
      `Actual: ${l.qty_current} und`,
      `Estado: ${l.status}  |  Origen: ${l.origin}`,
      `Creado: ${new Date(l.created_at).toLocaleString('es-CO')}`,
      `Vence: ${formatDateOnly(l.expiry_date)}`,
      ``,
      `📋 *Historial:*`,
      history,
      ``,
      `*Despachos / clientes:*`,
      dispatchHistory,
      ``,
      `*Devoluciones:*`,
      returnHistory,
      ``,
      `*Recepcion / origen documental:*`,
      receptionHistory,
      ``,
      `*Consumo real de materias primas:*`,
      materialHistory,
      ``,
      `*Produccion / resultado:*`,
      productionHistory,
      ``,
      `*Mermas asociadas:*`,
      wasteHistory,
      ``,
      `*Ordenes que consumieron este lote:*`,
      productionUses,
      ``,
      `*Materias primas esperadas segun BOM:*`,
      bomHistory
    ].filter(Boolean).join('\n');

  } else {
    const [rows] = await db.execute(
      `SELECT s.*, p.nombre, p.siigo_code
       FROM stock s
       JOIN productos p ON p.id = s.producto_id
       WHERE s.lote = ?
       LIMIT 1`,
      [params.id_lote]
    );

    if (!rows.length) {
      throw { status: 404, message: `Lote "${params.id_lote}" no encontrado` };
    }

    const s = rows[0];

    mensaje = [
      `🔎 *Lote: ${params.id_lote}*`,
      `Producto: ${s.nombre} (${s.siigo_code})`,
      `Cantidad: ${s.cantidad} und`,
      `Vence: ${s.fecha_venc || 'N/A'}`
    ].join('\n');
  }
  break;
}

      // ── Capacidad de fabricación ──────────────────────────────
      case 'CONSULTAR_CAPACIDAD_FABRICACION': {
        const productReference = params.id_producto_final || params.id_item;
        if (!productReference) {
          throw { status: 400, message: 'CONSULTAR_CAPACIDAD_FABRICACION requiere id_producto_final' };
        }
        const desiredRaw = params.cantidad_deseada;
        const desired = desiredRaw == null || desiredRaw === '' ? null : Number(desiredRaw);
        if (desired != null && (!Number.isFinite(desired) || desired <= 0)) {
          throw { status: 400, message: 'cantidad_deseada debe ser positiva' };
        }
        const p = await findProductBySku(db, productReference);
        assertInternalProductionProduct(p);
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.id AS insumo_id FROM bom b
           JOIN productos pr ON pr.id = b.insumo_id
           WHERE b.producto_final_id = ? AND b.etapa = 'PRODUCCION'`, [p.id]
        ).catch(() => [[]]);
        if (!bom.length) {
          throw { status: 409, message: `${productReference} no tiene BOM configurado` };
        }
        let puedeProd = true;
        let capacidadMaxima = Infinity;
        const checks  = [];
        for (const item of bom) {
          const perUnit = Number(item.cantidad_por_unidad);
          if (!Number.isFinite(perUnit) || perUnit <= 0) {
            throw { status: 409, message: `El BOM de ${item.siigo_code} tiene una cantidad por unidad invalida` };
          }
          const disp = await getEligibleStock(db, item.insumo_id, bodegaId);
          const componentCapacity = Math.max(Math.floor(disp / perUnit), 0);
          capacidadMaxima = Math.min(capacidadMaxima, componentCapacity);
          if (desired == null) {
            checks.push(`  ${item.siigo_code}: disponible ${disp}, consumo ${perUnit}/ud, capacidad ${componentCapacity} uds`);
          } else {
            const needed = roundQty(perUnit * desired);
            const check = formatCapacityCheck(item.siigo_code, needed, disp);
            if (!check.ok) puedeProd = false;
            checks.push(check.line);
          }
        }
        mensaje = desired == null
          ? [
              `*Capacidad actual de ${productReference}: ${Number.isFinite(capacidadMaxima) ? capacidadMaxima : 0} uds*`,
              ...checks,
            ].join('\n')
          : [
              `${puedeProd ? '✅' : '❌'} *Capacidad para ${desired} uds de ${productReference}:*`,
              ...checks,
            ].join('\n');
        break;
      }

      // ── CONFIRMAR_MATERIALES_PRODUCCION ──────────────────────
      case 'CONFIRMAR_MATERIALES_PRODUCCION': {
        const confirmation = await confirmProductionMaterials({ orderId: params.id_orden, userId: user.id });
        mensaje = confirmation.already_confirmed
          ? `Los materiales de ${confirmation.order_code} ya estaban confirmados. No se modifico inventario.`
          : [
              `Materiales confirmados para ${confirmation.order_code}.`,
              'Orden en proceso.',
              ...confirmation.consumed.map(item => `- Lote ${item.lpn}: ${item.qty_taken}`),
            ].join('\n');
        responseContext.production_confirmation = confirmation;
        break;
      }

      // ── Excepción picking ─────────────────────────────────────
      case 'EXCEPCION_PICKING': {
        if (!params.lote_sugerido || !params.lote_usado) {
          throw { status: 400, message: 'EXCEPCION_PICKING requiere lote_sugerido y lote_usado' };
        }
        const [lotInfoRows] = await db.execute(
          `SELECT l.lpn, l.status, l.qty_current, p.siigo_code, p.nombre
           FROM lots l
           JOIN productos p ON p.id = l.product_id
           WHERE l.lpn IN (?, ?)
           ORDER BY FIELD(l.lpn, ?, ?)`,
          [params.lote_sugerido, params.lote_usado, params.lote_sugerido, params.lote_usado]
        ).catch(() => [[]]);
        const lotDetails = lotInfoRows.length
          ? lotInfoRows.map(l => `Lote ${l.lpn}: ${l.nombre} (${l.siigo_code}), estado ${l.status}, saldo ${l.qty_current} und`).join('\n')
          : 'No se encontro detalle de los lotes en maestro de lots.';
        await logSystemEvent(db, {
          modulo: 'picking', nivel: 'WARN',
          mensaje: `Excepción picking: lote ${params.lote_sugerido} reemplazado por ${params.lote_usado}`,
          usuario_id: user.id,
          payload: {
            lote_sugerido: params.lote_sugerido,
            lote_usado:    params.lote_usado,
            id_orden:      params.id_orden  || null,
            id_item:       params.id_item   || null,
          },
        });

        mensaje = [
          `⚠️ *Excepción de picking registrada*`,
          `Lote sugerido: ${params.lote_sugerido}`,
          `Lote usado:    ${params.lote_usado}`,
          lotDetails,
          params.id_orden ? `Orden: ${params.id_orden}` : '',
          params.id_item  ? `Producto: ${params.id_item}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      case 'MODO_CHARLA': {
        mensaje = params.texto ||
                  params.mensaje ||
                  params.message ||
                  info.texto ||
                  info.mensaje ||
                  info.message ||
                  'Hola. Soy el asistente del WMS. Puedo ayudarte con stock, recepcion, produccion, despachos, trazabilidad y aprobaciones. ¿Que necesitas?';
        break;
      }

      default:
        throw { status: 400, message: `Acción desconocida: ${action}` };
    }

    await saveLog(db, { from, action, priority, payload: rawBody, response: { message: mensaje, mensaje, context: responseContext }, status: 'PROCESSED' });
    console.log(`[webhook] ✅ action="${action}" completado OK`);
    return builderbotResponse(res, 200, { ok: true, message: mensaje, mensaje, context: responseContext });

} catch (err) {
  const errMsg = err.message || 'Error interno';
  const statusCode = Number(err.status || 500);
  const isBusinessError = statusCode >= 400 && statusCode < 500;

  console.error(`[webhook] ❌ action="${action}" error:`, errMsg);

  await saveLog(db, {
    from,
    action,
    priority,
    payload: rawBody,
    response: { error: errMsg, statusCode },
    status: isBusinessError ? 'REJECTED' : 'ERROR'
  }).catch(() => {});

  const body = {
    ok: false,
    message: `❌ ${errMsg}`,
    mensaje: `❌ ${errMsg}`,
    error: errMsg,
    status: statusCode
  };

  if (isBusinessError) {
    return builderbotResponse(res, 200, body);
  }

  return builderbotResponse(res, 200, body);
} finally {
    await db.end().catch(() => {});
  }
};

