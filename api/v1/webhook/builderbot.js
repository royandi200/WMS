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
const { randomUUID } = require('crypto');

const DB = () => mysql.createConnection({
  host:           process.env.DB_HOST,
  port:           parseInt(process.env.DB_PORT || '3306'),
  user:           process.env.DB_USER,
  password:       process.env.DB_PASSWORD,
  database:       process.env.DB_NAME || 'kainotomia_WMS',
  connectTimeout: 10000,
});

// BB Cloud API token y Bot ID
const BB_TOKEN  = 'bb-78e67fdf-098a-499a-805d-68bb23e897bb';
const BB_BOT_ID = '5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d';

// ─────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────
const RBAC = {
  INGRESO_RECEPCION:               ['Operario','Supervisor','Admin'],
  SOLICITAR_INICIO_PRODUCCION:     ['Operario','Supervisor','Admin'],
  AVANCE_FASES:                    ['Operario','Supervisor','Admin'],
  REPORTE_MERMA:                   ['Operario','Supervisor','Admin'],
  CONFIRMAR_MATERIALES_PRODUCCION: ['Operario','Supervisor','Admin'],
  EXCEPCION_PICKING:               ['Operario','Supervisor','Admin'],
  GESTION_DEVOLUCION:              ['Operario','Supervisor','Admin'],
  CONSULTAR_STOCK_MATERIA_PRIMA:   ['Operario','Supervisor','Admin'],
  CONSULTAR_STOCK_PRODUCTO_TERMINADO: ['Operario','Supervisor','Admin'],
  CONSULTAR_ESTADO_PRODUCCION:     ['Operario','Supervisor','Admin'],
  CONSULTAR_TRAZABILIDAD_LOTE:     ['Operario','Supervisor','Admin'],
  CONSULTAR_CAPACIDAD_FABRICACION: ['Operario','Supervisor','Admin'],
  MODO_CHARLA:                     ['Operario','Supervisor','Admin'],
  SOLICITAR_CIERRE_PRODUCCION:     ['Operario','Supervisor','Admin'],
  SOLICITAR_DESPACHO:              ['Operario','Supervisor','Admin'],
  APROBAR_SOLICITUD:               ['Supervisor','Admin'],
  RECHAZAR_SOLICITUD:              ['Supervisor','Admin'],
  AJUSTE_INVENTARIO:               ['Supervisor','Admin'],
  CONSULTAR_SOLICITUDES_PENDIENTES:['Supervisor','Admin'],
};

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
    `INSERT INTO system_logs (nivel, modulo, mensaje, usuario_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [nivel || 'INFO', modulo || 'webhook', mensaje, usuario_id || null,
     payload ? JSON.stringify(payload) : null]
  ).catch(() => {});
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
      const number   = rawPhone.replace(/[^\d]/g, '');

      console.log(`[pushWA] Intentando enviar WA`);
      console.log(`[pushWA]   phone original  : "${rawPhone}"`);
      console.log(`[pushWA]   number sanitizado: "${number}"`);
      console.log(`[pushWA]   destino URL     : app.builderbot.cloud/api/v2/${BB_BOT_ID}/messages`);
      console.log(`[pushWA]   texto (primeros 120 chars): ${String(text).slice(0, 120)}`);

      if (!number) {
        console.warn('[pushWA] ⚠️  Número vacío tras sanitizar — se omite envío.');
        return resolve(null);
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
        console.error('[pushWA] ❌ Error de red:', e.message);
        resolve(null);
      });

      req.write(body);
      req.end();

    } catch (e) {
      console.error('[pushWA] ❌ Excepción:', e.message);
      resolve(null);
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
     LIMIT 1`
  ).catch(() => [[]]);

  const phone = rows[0]?.telefono || null;
  if (phone) {
    console.log(`[getSupervisorPhone] ✅ Teléfono seleccionado: "${phone}"`);
  } else {
    console.warn('[getSupervisorPhone] ⚠️  No se encontró ningún supervisor/admin activo con teléfono registrado.');
  }
  return phone;
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
                l.status AS estado_lote
         FROM stock s
         JOIN productos p ON p.id = s.producto_id
         LEFT JOIN lots l ON l.lpn = s.lote
         WHERE p.siigo_code = ?
         ORDER BY CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END, l.expiry_date ASC, s.id ASC`,
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

// ─────────────────────────────────────────────────────────────
// executeApprovedPayload — acciones que requieren aprobación
// ─────────────────────────────────────────────────────────────
async function executeApprovedPayload(db, { accion, payload, aprobador_id, bodegaId }) {
  switch (accion) {

    case 'SOLICITAR_INICIO_PRODUCCION': {
      const [ordenRows] = await db.execute(
        `SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1`, [payload.order_id]
      );
      if (!ordenRows.length) throw { status: 404, message: `Orden #${payload.order_id} no encontrada` };
      const orden = ordenRows[0];

      const [bom] = await db.execute(
        `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
                pr.siigo_code, pr.nombre
         FROM bom b
         JOIN productos pr ON pr.id = b.insumo_id
         WHERE b.producto_final_id = ?`, [orden.producto_id]
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
        approved_by: aprobador_id,
      });
      await logSystemEvent(db, {
        modulo: 'produccion', nivel: 'INFO',
        mensaje: `Orden ${orden.codigo_orden} CERRADA — ${cantReal} und producidas`,
        usuario_id: aprobador_id,
        payload: { orden_id: orden.id, codigo_orden: orden.codigo_orden, cantReal, lote: lpnOP },
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
      return { orden: orden.codigo_orden, lote: lpnOP, cantidad: cantReal };
    }

    case 'SOLICITAR_DESPACHO': {
  const cantDesp  = Number(payload.qty) || 0;
  const lotIdDesp = await lotIdByLpn(db, payload.lpn);

  if (payload.lpn) {
    await db.execute(
      `UPDATE stock SET cantidad = GREATEST(0, cantidad - ?)
       WHERE producto_id=? AND bodega_id=? AND lote=? LIMIT 1`,
      [cantDesp, payload.product_id, bodegaId, payload.lpn]
    );

    await db.execute(
  `UPDATE lots
   SET qty_current = GREATEST(0, qty_current - ?),
       status = IF(qty_current <= 0, 'DESPACHADO', 'DISPONIBLE')
   WHERE lpn = ?`,
  [cantDesp, payload.lpn]
).catch(() => {});
  }

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
    `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
     VALUES ('salida',?,?,?,?,?,'despacho_aprobado',?)`,
    [payload.product_id, bodegaId, payload.lpn || null, cantDesp, despIns.insertId, aprobador_id]
  );

  const balance = await getStockBalance(db, payload.product_id, bodegaId);

  await logKardex(db, {
    product_id: payload.product_id,
    user_id: aprobador_id,
    action: 'DESPACHO',
    qty: -cantDesp,
    lot_id: lotIdDesp,
    balance_after: balance,
    reference: `despacho:${numeroDespacho}`,
    notes: payload.customer ? `Cliente: ${payload.customer}` : null,
    approved_by: aprobador_id,
  });

  if (payload.operario_phone) {
    await pushWA(
      payload.operario_phone,
      `✅ *Despacho aprobado*\nNro despacho: ${numeroDespacho}\nProducto despachado: ${cantDesp} und`
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const rawBody = req.body || {};
  let info = rawBody.info;
  if (typeof info === 'string') { try { info = JSON.parse(info); } catch { info = {}; } }
  if (!info || typeof info !== 'object') info = {};

  const from     = rawBody.from;
  let action     = info['@ction'] || info.action || 'UNKNOWN';
  let params     = info.params || {};
  const priority = info.priority || 'baja';

  // ── [FIX 17] Interceptor de lenguaje natural ──────────────
  // Si BuilderBot no pudo extraer una acción estructurada (UNKNOWN o
  // MODO_CHARLA), intentamos detectar aprobación/rechazo en el texto
  // libre del mensaje original antes de entrar al switch.
  if (action === 'UNKNOWN' || action === 'MODO_CHARLA') {
    const rawText = info.texto || info.content || info.message ||
                    rawBody.body || rawBody.text || '';
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
      return res.status(200).json({ ok: false, message: msg, mensaje: msg, error: 'UNREGISTERED_PHONE' });
    }

    const bodegaId = await getDefaultBodega(db);

    const rolRaw  = user.rol_nombre || '';
    const rolNorm = rolRaw.charAt(0).toUpperCase() + rolRaw.slice(1).toLowerCase();
    const rolesPermitidos = RBAC[action];
    if (rolesPermitidos && !rolesPermitidos.includes(rolNorm)) {
      const msg = `🚫 No tienes permiso para ejecutar *${action}*.\nTu rol: ${rolRaw}`;
      await saveLog(db, { from, action, priority, payload: rawBody, response: { error: 'RBAC_DENIED' }, status: 'DENIED' });
      return res.status(403).json({ ok: false, message: msg, mensaje: msg, error: 'RBAC_DENIED', rol: rolRaw });
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
          await logKardex(db, {
            product_id: p.id, user_id: user.id, action: 'INGRESO_NOVEDAD',
            qty: cantMala, lot_id: lotIdNov,
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
        const cantPlan = Number(params.cantidad_planificada) || 0;

        const [bom] = await db.execute(
          `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
                  pr.siigo_code, pr.nombre
           FROM bom b
           JOIN productos pr ON pr.id = b.insumo_id
           WHERE b.producto_final_id = ?`, [p.id]
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

        const supPhone = await getSupervisorPhone(db);
        console.log(`[SOLICITAR_INICIO_PRODUCCION] supPhone="${supPhone}" | solicitud="${codigo}" | orden="${codigoOrden}"`);
        if (supPhone) {
          await pushWA(
            supPhone,
            [
              `🏭 *Solicitud de inicio de producción: ${codigo}*`,
              `Orden: ${codigoOrden}`,
              `Producto: ${params.id_producto_final} — ${cantPlan} uds`,
              `Solicitado por: ${user.nombre}`,
              ``, `📋 *Disponibilidad de materiales:*`,
              ...picking,
              ``,
              `Para aprobar responde: *apruebo ${codigo}*`,
              `Para rechazar responde: *rechazo ${codigo}*`
            ].join('\n')
          );
        } else {
          console.warn(`[SOLICITAR_INICIO_PRODUCCION] ⚠️  supPhone es null — no se enviará WA al supervisor.`);
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
          ``, `El supervisor fue notificado. Espera su aprobación.`
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
  const p = await findProductBySku(db, params.id_item);
  const cantMerma = Math.abs(Number(params.cantidad));
  const lotIdMerma = await lotIdByLpn(db, params.id_lote);

  let ordenId = null;
  let codigoOrden = null;
  let tipoMerma = params.id_orden ? 'PROCESO' : 'BODEGA';

  if (params.id_orden) {
    const [opRows] = await db.execute(
      `SELECT id, codigo_orden, estado
       FROM ordenes_produccion
       WHERE id = ? OR codigo_orden = ?
       LIMIT 1`,
      [params.id_orden, params.id_orden]
    );

    if (!opRows.length) {
      throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
    }

    const op = opRows[0];
    ordenId = op.id;
    codigoOrden = op.codigo_orden;

    if (op.estado !== 'EN_PROCESO') {
      throw {
        status: 409,
        message: `La orden ${op.codigo_orden} está en estado "${op.estado}". Si ya fue cerrada, reporta la merma usando el lote correspondiente.`
      };
    }
  }

  const numeroMerma = `MER-${Date.now()}`;

  await db.execute(
    `INSERT INTO mermas
       (numero, tipo, producto_id, lote, orden_produccion_id, cantidad, motivo, usuario_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      numeroMerma,
      tipoMerma,
      p.id,
      params.id_lote || null,
      ordenId,
      cantMerma,
      params.motivo || null,
      user.id
    ]
  );

  await db.execute(
    `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
     VALUES ('ajuste',?,?,?,?,'merma_wa',?)`,
    [p.id, bodegaId, params.id_lote || null, -cantMerma, user.id]
  );

  if (params.id_lote) {
    await db.execute(
      `UPDATE stock
       SET cantidad = GREATEST(0, cantidad - ?)
       WHERE producto_id = ? AND lote = ?`,
      [cantMerma, p.id, params.id_lote]
    );

    await db.execute(
      `UPDATE lots
       SET qty_current = GREATEST(0, qty_current - ?),
           status = IF(GREATEST(0, qty_current - ?) <= 0, 'AGOTADO', 'DISPONIBLE')
       WHERE lpn = ?`,
      [cantMerma, cantMerma, params.id_lote]
    ).catch(() => {});
  }

  const balance = await getStockBalance(db, p.id, bodegaId);

  const mermaNoteParts = [];
  if (params.motivo) mermaNoteParts.push(`Motivo: ${params.motivo}`);
  if (codigoOrden) mermaNoteParts.push(`Orden: ${codigoOrden}`);
  if (params.id_lote) mermaNoteParts.push(`Lote: ${params.id_lote}`);
  if (numeroMerma) mermaNoteParts.push(`Merma: ${numeroMerma}`);
  const mermaNote = mermaNoteParts.join(' | ') || null;

  await logKardex(db, {
    product_id: p.id,
    user_id: user.id,
    action: params.id_orden ? 'MERMA_PROCESO' : 'MERMA_BODEGA',
    qty: -cantMerma,
    lot_id: lotIdMerma,
    balance_after: balance,
    reference: ordenId
      ? `orden_produccion:${codigoOrden}`
      : (params.id_lote ? `lote:${params.id_lote}` : null),
    notes: mermaNote,
  });

  mensaje = [
    `⚠️ *Merma registrada*`,
    `Nro merma: ${numeroMerma}`,
    `Producto: ${params.id_item}`,
    `Cantidad: ${cantMerma}`,
    `Motivo: ${params.motivo || 'No especificado'}`,
    codigoOrden ? `Orden: ${codigoOrden}` : '',
    params.id_lote ? `Lote: ${params.id_lote}` : ''
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

        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_CIERRE_PRODUCCION', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            order_id:       orden.id,
            codigo_orden:   orden.codigo_orden,
            qty_real:       params.cantidad_real != null ? params.cantidad_real : null,
            operario_phone: from,
          }), user.id]
        );

        const supPhone = await getSupervisorPhone(db);
        console.log(`[SOLICITAR_CIERRE_PRODUCCION] supPhone="${supPhone}" | solicitud="${codigo}" | orden="${orden.codigo_orden}"`);
        if (supPhone) {
          await pushWA(
            supPhone,
            [
              `🏭 *Solicitud cierre de producción: ${codigo}*`,
              `Orden: ${orden.codigo_orden}`,
              `Estado actual: ${orden.estado}`,
              `Cantidad real: ${params.cantidad_real ?? orden.cantidad_planeada}`,
              `Operario: ${user.nombre}`,
              ``,
              `Para aprobar responde: *apruebo ${codigo}*`,
              `Para rechazar responde: *rechazo ${codigo}*`
            ].join('\n')
          );
        } else {
          console.warn(`[SOLICITAR_CIERRE_PRODUCCION] ⚠️  supPhone es null — no se enviará WA al supervisor.`);
        }

        mensaje = [
          `⏳ *Solicitud enviada: ${codigo}*`,
          `Orden: ${orden.codigo_orden}`,
          `Cantidad real: ${params.cantidad_real ?? orden.cantidad_planeada}`,
          `El supervisor fue notificado.`
        ].join('\n');
        break;
      }

      // ── 6. SOLICITAR_DESPACHO → encolar ──────────────────────
      case 'SOLICITAR_DESPACHO': {
        if (!params.id_item) throw { status: 400, message: 'id_item es obligatorio para SOLICITAR_DESPACHO' };
        const p      = await findProductBySku(db, params.id_item);
        const lot    = await lotIdByLpn(db, params.id_lote);
        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_DESPACHO', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            lot_id:         lot,
            lpn:            params.id_lote,
            product_id:     p.id,
            qty:            params.cantidad,
            customer:       params.cliente_destino,
            operario_phone: from,
          }), user.id]
        );

        const supPhone = await getSupervisorPhone(db);
        console.log(`[SOLICITAR_DESPACHO] supPhone="${supPhone}" | solicitud="${codigo}"`);
        if (supPhone) {
          await pushWA(
            supPhone,
            [
              `📦 *Solicitud de despacho: ${codigo}*`,
              `Producto: ${params.id_item}`,
              `Lote: ${params.id_lote} — Cantidad: ${params.cantidad}`,
              `Cliente: ${params.cliente_destino || 'N/A'}`,
              ``,
              `Para aprobar responde: *apruebo ${codigo}*`,
              `Para rechazar responde: *rechazo ${codigo}*`
            ].join('\n')
          );
        } else {
          console.warn(`[SOLICITAR_DESPACHO] ⚠️  supPhone es null — no se enviará WA al supervisor.`);
        }

        mensaje = [
          `⏳ *Solicitud de despacho: ${codigo}*`,
          `Producto: ${params.id_item}`,
          `Lote: ${params.id_lote}`,
          `Cantidad: ${params.cantidad}`,
          `El supervisor fue notificado.`
        ].join('\n');
        break;
      }

      // ── 7. GESTION_DEVOLUCION ─────────────────────────────────
      case 'GESTION_DEVOLUCION': {
  const p          = await findProductBySku(db, params.id_item);
  const estadoNorm = normalizarEstadoDevolucion(params.estado);
  const lpnDev     = `L-DEV-${p.siigo_code}-${Date.now()}`;
  const numeroRec  = await nextRecepcionNumero(db);
  const numeroDev  = `DEV-${Date.now()}`;

  const [recIns] = await db.execute(
    `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id, observaciones)
     VALUES (?,?,?,'completada',?,?)`,
    [
      numeroRec,
      bodegaId,
      params.cliente_origen || null,
      user.id,
      `Devolución - ${estadoNorm}`
    ]
  );

  await db.execute(
    `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
     VALUES (?,?,?,?,?)`,
    [recIns.insertId, p.id, lpnDev, params.cantidad, params.cantidad]
  );

  const lotIdDev = await createLot(db, {
    lpn: lpnDev,
    product_id: p.id,
    bodega_id: bodegaId,
    qty: params.cantidad,
    origin: 'DEVOLUCION',
    received_by: user.id,
    notes: `Cliente: ${params.cliente_origen || 'N/A'} | Estado: ${estadoNorm}`,
  });

  // Si la devolución queda en cuarentena, NO suma stock disponible
  if (estadoNorm === 'CUARENTENA') {
    await db.execute(
      `UPDATE lots
       SET status = 'CUARENTENA'
       WHERE id = ?`,
      [lotIdDev]
    ).catch(() => {});
  } else {
    await upsertStock(db, {
      producto_id: p.id,
      bodega_id: bodegaId,
      lote: lpnDev,
      cantidad: params.cantidad
    });
  }

  await db.execute(
    `INSERT INTO devoluciones
       (numero, producto_id, lote, cliente_origen, cantidad, estado, recepcion_id, usuario_id, observaciones, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      numeroDev,
      p.id,
      lpnDev,
      params.cliente_origen || null,
      params.cantidad,
      estadoNorm,
      recIns.insertId,
      user.id,
      `Registrada desde WhatsApp`
    ]
  );

  const balance = await getStockBalance(db, p.id, bodegaId);

  await logKardex(db, {
    product_id: p.id,
    user_id: user.id,
    action: 'DEVOLUCION',
    qty: params.cantidad,
    lot_id: lotIdDev,
    balance_after: balance,
    reference: `recepcion:${numeroRec}`,
    notes: `Cliente: ${params.cliente_origen || 'N/A'} | Estado: ${estadoNorm} | Devolución: ${numeroDev}`,
  });

  mensaje = [
    `🔄 *Devolución registrada*`,
    `Nro devolución: ${numeroDev}`,
    `Producto: ${params.id_item}`,
    `Cantidad: ${params.cantidad}`,
    `Estado: ${estadoNorm}`,
    `Lote: ${lpnDev}`,
    estadoNorm === 'CUARENTENA'
      ? `Destino: Cuarentena (no suma stock disponible)`
      : `Destino: Stock disponible`
  ].join('\n');
  break;
}

      // ── 8. APROBAR_SOLICITUD ──────────────────────────────────
      case 'APROBAR_SOLICITUD': {
        const [rows] = await db.execute(
          `SELECT * FROM aprobaciones WHERE codigo_solicitud = ? AND estado = 'PENDIENTE' LIMIT 1`,
          [params.id_solicitud]
        );
        if (!rows.length) throw { status: 404, message: `Solicitud ${params.id_solicitud} no encontrada o ya procesada` };
        const solicitud = rows[0];
        const payload   = typeof solicitud.payload === 'string'
          ? JSON.parse(solicitud.payload) : solicitud.payload;
        console.log(`[APROBAR_SOLICITUD] Procesando solicitud="${params.id_solicitud}" accion="${solicitud.accion}"`);
        const execResult = await executeApprovedPayload(db, {
          accion: solicitud.accion, payload, aprobador_id: user.id, bodegaId,
        });
        await db.execute(
          `UPDATE aprobaciones SET estado='APROBADO', procesado_por=?, procesado_en=NOW() WHERE codigo_solicitud=?`,
          [user.id, params.id_solicitud]
        );
        await logSystemEvent(db, { modulo: 'aprobaciones', nivel: 'INFO',
          mensaje: `Solicitud ${params.id_solicitud} aprobada`,
          usuario_id: user.id, payload: execResult });
        mensaje = [
          `✅ *${params.id_solicitud} Aprobada*`,
          `Acción: ${solicitud.accion.replace(/_/g,' ')}`,
          JSON.stringify(execResult)
        ].join('\n');
        break;
      }

      // ── 9. RECHAZAR_SOLICITUD ─────────────────────────────────
      case 'RECHAZAR_SOLICITUD': {
        const [rows] = await db.execute(
          `SELECT * FROM aprobaciones WHERE codigo_solicitud = ? AND estado = 'PENDIENTE' LIMIT 1`,
          [params.id_solicitud]
        );
        if (!rows.length) throw { status: 404, message: `Solicitud ${params.id_solicitud} no encontrada o ya procesada` };
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
        const lotIdAjuste = await lotIdByLpn(db, params.id_lote);
        if (params.id_lote) {
          await db.execute(
            `UPDATE stock SET cantidad = GREATEST(0, cantidad + ?) WHERE producto_id=? AND lote=?`,
            [diff, p.id, params.id_lote]
          );
          await db.execute(
            `UPDATE lots SET qty_current = GREATEST(0, qty_current + ?) WHERE lpn = ?`,
            [diff, params.id_lote]
          ).catch(() => {});
        } else {
          await db.execute(
            `UPDATE stock SET cantidad = GREATEST(0, cantidad + ?) WHERE producto_id=? AND bodega_id=? LIMIT 1`,
            [diff, p.id, bodegaId]
          );
        }
        await db.execute(
          `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
           VALUES ('ajuste',?,?,?,?,'ajuste_manual',?)`,
          [p.id, bodegaId, params.id_lote || null, diff, user.id]
        );
        const balance = await getStockBalance(db, p.id, bodegaId);
        await logKardex(db, {
          product_id: p.id, user_id: user.id, action: 'AJUSTE_INVENTARIO',
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
          `SELECT a.codigo_solicitud, a.accion, a.creado_en, u.nombre AS operario
           FROM aprobaciones a
           LEFT JOIN usuarios u ON u.id = a.solicitado_por
           WHERE a.estado = 'PENDIENTE'
           ORDER BY a.creado_en ASC LIMIT 10`
        );
        const lines = rows.length
          ? rows.map(r => `  • ${r.codigo_solicitud} — ${r.accion.replace(/_/g,' ')} (${r.operario || 'N/A'})`).join('\n')
          : '  (No hay solicitudes pendientes)';
        mensaje = `📋 *Solicitudes pendientes:*\n${lines}`;
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
            // [FIX 21] Lotes vencidos: marcar con 🚨 y bloque de alerta al final
            const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
            const lotesVencidos = [];
            const lotesLines = result.rows
              .map(r => {
                const disp = parseFloat(r.disponible || 0);
                const lpnCorto = r.lote && r.lote.length > 26 ? r.lote.slice(0, 26) + '…' : (r.lote || 'sin lote');
                let venceStr = '';
                if (r.vence) {
                  const fv = new Date(r.vence); fv.setHours(0, 0, 0, 0);
                  if (fv < hoy) {
                    venceStr = ` 🚨 *VENCIÓ ${fv.toLocaleDateString('es-CO')}*`;
                    lotesVencidos.push(lpnCorto);
                  } else {
                    venceStr = ` (vence ${fv.toLocaleDateString('es-CO')})`;
                  }
                }
                return `  • ${lpnCorto}: *${disp} und*${venceStr}`;
              })
              .join('\n');
            const alertaVencidos = lotesVencidos.length
              ? `\n\n⛔ *ALERTA — ${lotesVencidos.length} lote${lotesVencidos.length > 1 ? 's' : ''} VENCIDO${lotesVencidos.length > 1 ? 'S' : ''}:*\n${lotesVencidos.map(l => `  ❌ ${l}`).join('\n')}\n_Requiere disposición inmediata. Notifica al supervisor._`
              : '';
            mensaje = [
              `📊 *Stock ${label}: ${params.id_item}*`,
              `Total disponible: *${totalDisp} und* (${result.rows.length} lote${result.rows.length > 1 ? 's' : ''})`,
              ``,
              `📦 *Lotes FIFO:*`,
              lotesLines,
              alertaVencidos
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
    `SELECT l.*, p.nombre, p.siigo_code, op.codigo_orden
     FROM lots l
     JOIN productos p ON p.id = l.product_id
     LEFT JOIN ordenes_produccion op ON op.id = l.production_order_id
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
         k.created_at
       FROM kardex k
       WHERE k.lot_id = ?
       ORDER BY k.created_at ASC`,
      [l.id]
    ).catch(() => [[]]);

    const history = kRows.length
      ? kRows.map(k => {
          const fecha = new Date(k.created_at).toLocaleString('es-CO');
          let extra = '';

          if (k.notes) {
            extra = ` | ${k.notes}`;
          }

          return `  ${fecha} | ${k.action}: ${k.qty > 0 ? '+' : ''}${k.qty} (saldo: ${k.balance_after})${extra}`;
        }).join('\n')
      : '  (Sin movimientos en kardex)';

    mensaje = [
      `🔎 *Lote: ${params.id_lote}*`,
      `Producto: ${l.nombre} (${l.siigo_code})`,
      l.codigo_orden ? `Orden origen: ${l.codigo_orden}` : (l.notes ? `Referencia: ${l.notes}` : ''),
      `Inicial: ${l.qty_initial} und`,
      `Actual: ${l.qty_current} und`,
      `Estado: ${l.status}  |  Origen: ${l.origin}`,
      `Creado: ${new Date(l.created_at).toLocaleString('es-CO')}`,
      `Vence: ${l.expiry_date || 'N/A'}`,
      ``,
      `📋 *Historial:*`,
      history
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
        const p = await findProductBySku(db, params.id_producto_final);
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.id AS insumo_id FROM bom b
           JOIN productos pr ON pr.id = b.insumo_id
           WHERE b.producto_final_id = ?`, [p.id]
        ).catch(() => [[]]);
        let puedeProd = true;
        const checks  = [];
        for (const item of bom) {
          const needed = roundQty(parseFloat(item.cantidad_por_unidad) * params.cantidad_deseada);
          const [st]   = await db.execute(
            `SELECT COALESCE(SUM(cantidad - reservada), 0) AS disponible
             FROM stock WHERE producto_id=? AND bodega_id=?`,
            [item.insumo_id, bodegaId]
          );
          const disp = parseFloat(st[0].disponible || 0);
          const ok   = disp >= needed;
          if (!ok) puedeProd = false;
          checks.push(`  ${ok ? '✅' : '❌'} ${item.siigo_code}: necesita ${needed}, disponible ${disp}`);
        }
        mensaje = [
          `${puedeProd ? '✅' : '❌'} *Capacidad para ${params.cantidad_deseada} uds de ${params.id_producto_final}:*`,
          ...checks
        ].join('\n');
        break;
      }

      // ── CONFIRMAR_MATERIALES_PRODUCCION ──────────────────────
      case 'CONFIRMAR_MATERIALES_PRODUCCION': {
        const [ordenRows] = await db.execute(
          `SELECT * FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!ordenRows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const orden = ordenRows[0];

        if (!['APROBADA','PLANEADA'].includes(orden.estado)) {
          throw { status: 409, message: `La orden ${params.id_orden} está en estado ${orden.estado} y no puede confirmarse` };
        }

        const [bom] = await db.execute(
          `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad,
                  pr.siigo_code, pr.nombre
           FROM bom b
           JOIN productos pr ON pr.id = b.insumo_id
           WHERE b.producto_final_id = ?`, [orden.producto_id]
        ).catch(() => [[]]);

        for (const item of bom) {
          const cantInsumo = roundQty(parseFloat(item.cantidad_por_unidad) * parseFloat(orden.cantidad_planeada));
          if (cantInsumo <= 0) continue;

          await db.execute(
            `UPDATE stock
             SET cantidad  = GREATEST(0, cantidad  - ?),
                 reservada = GREATEST(0, reservada - ?)
             WHERE producto_id = ? AND bodega_id = ?
             ORDER BY id ASC LIMIT 1`,
            [cantInsumo, cantInsumo, item.insumo_id, bodegaId]
          ).catch(() => {});

          await db.execute(
            `INSERT INTO movimientos
               (tipo, producto_id, bodega_orig, cantidad, referencia_id, referencia_tipo, usuario_id)
             VALUES ('salida', ?, ?, ?, ?, 'orden_produccion', ?)`,
            [item.insumo_id, bodegaId, cantInsumo, orden.id, user.id]
          ).catch(() => {});

          const balInsumo = await getStockBalance(db, item.insumo_id, bodegaId);
          await logKardex(db, {
            product_id:    item.insumo_id,
            user_id:       user.id,
            action:        'CONSUMO_PRODUCCION',
            qty:           -cantInsumo,
            balance_after: balInsumo,
            reference:     `orden_produccion:${orden.codigo_orden}`,
            notes:         `Orden ${orden.codigo_orden} — ${orden.cantidad_planeada} uds confirmadas`,
          });
        }

        await db.execute(
          `UPDATE ordenes_produccion
           SET estado = 'EN_PROCESO', materiales_conf_en = NOW()
           WHERE id = ?`,
          [orden.id]
        );

        await logSystemEvent(db, { modulo: 'produccion', nivel: 'INFO',
          mensaje: `Materiales confirmados — orden ${orden.codigo_orden} EN_PROCESO`,
          usuario_id: user.id, payload: { orden: orden.codigo_orden } });

        mensaje = [
          `✅ *Materiales confirmados*`,
          `Orden: ${orden.codigo_orden} → EN_PROCESO`,
          `Insumos descontados del stock.`,
          params.lote_usado ? `Lote utilizado: ${params.lote_usado}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      // ── Excepción picking ─────────────────────────────────────
      case 'EXCEPCION_PICKING': {
        if (!params.lote_sugerido || !params.lote_usado) {
          throw { status: 400, message: 'EXCEPCION_PICKING requiere lote_sugerido y lote_usado' };
        }
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
          params.id_orden ? `Orden: ${params.id_orden}` : '',
          params.id_item  ? `Producto: ${params.id_item}` : ''
        ].filter(Boolean).join('\n');
        break;
      }

      case 'MODO_CHARLA': {
        mensaje = params.texto || 'No entendí tu mensaje. ¿Puedes ser más específico?';
        break;
      }

      default:
        throw { status: 400, message: `Acción desconocida: ${action}` };
    }

    await saveLog(db, { from, action, priority, payload: rawBody, response: { message: mensaje, mensaje }, status: 'PROCESSED' });
    console.log(`[webhook] ✅ action="${action}" completado OK`);
    return res.json({ ok: true, message: mensaje, mensaje });

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
    status: isBusinessError ? 'BUSINESS_ERROR' : 'ERROR'
  }).catch(() => {});

  const body = {
    ok: false,
    message: `❌ ${errMsg}`,
    mensaje: `❌ ${errMsg}`,
    error: errMsg,
    status: statusCode
  };

  if (isBusinessError) {
    return res.status(200).json(body);
  }

  return res.status(500).json(body);
} finally {
    await db.end().catch(() => {});
  }
};
