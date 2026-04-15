// =============================================================
// api/v1/webhook/builderbot.js — ÚNICO stack WMS × WhatsApp
// POST /api/v1/webhook/builderbot
// =============================================================
// Stack: Vercel Serverless + mysql2 (sin Express, sin Sequelize)
// Este es el ÚNICO archivo que procesa webhooks de BuilderBot.
// builderbot.service.js (Express) fue eliminado — toda la lógica
// vive aquí para evitar duplicación y conflictos de modelos.
// =============================================================
const mysql  = require('mysql2/promise');
const axios  = require('axios');
const { randomUUID } = require('crypto');

const DB = () => mysql.createConnection({
  host:           process.env.DB_HOST,
  port:           parseInt(process.env.DB_PORT || '3306'),
  user:           process.env.DB_USER,
  password:       process.env.DB_PASSWORD,
  database:       process.env.DB_NAME || 'kainotomia_WMS',
  connectTimeout: 10000,
});

// ─────────────────────────────────────────────────────────────
// RBAC — roles que pueden ejecutar cada acción
// ─────────────────────────────────────────────────────────────
const RBAC = {
  // Operario puede reportar y consultar
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
  // Solo Supervisor/Admin pueden aprobar, rechazar, cerrar, despachar
  SOLICITAR_CIERRE_PRODUCCION:     ['Supervisor','Admin'],
  SOLICITAR_DESPACHO:              ['Supervisor','Admin'],
  APROBAR_SOLICITUD:               ['Supervisor','Admin'],
  RECHAZAR_SOLICITUD:              ['Supervisor','Admin'],
  AJUSTE_INVENTARIO:               ['Supervisor','Admin'],
  CONSULTAR_SOLICITUDES_PENDIENTES:['Supervisor','Admin'],
};

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
  ).catch(() => {});  // nunca bloquea el flujo principal
}

async function sendBack(phone, text) {
  if (!process.env.BUILDERBOT_SEND_URL) return;
  await axios.post(
    process.env.BUILDERBOT_SEND_URL,
    { phone, message: text },
    { headers: { 'x-api-key': process.env.BUILDERBOT_API_KEY || '' }, timeout: 8000 }
  ).catch(() => {});
}

/** Crea registro en lots y devuelve UUID */
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

/** Resuelve LPN → lot UUID. Null si no existe. */
async function lotIdByLpn(db, lpn) {
  if (!lpn) return null;
  const [rows] = await db.execute(
    `SELECT id FROM lots WHERE lpn = ? LIMIT 1`, [lpn]
  ).catch(() => [[]]);
  return rows[0]?.id || null;
}

/** Escribe en kardex */
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

/** Saldo actual en stock */
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
  const botEmail = `${phone}@wa.bot`;
  const [rows] = await db.execute(
    `SELECT u.*, r.nombre AS rol_nombre FROM usuarios u
     LEFT JOIN roles r ON r.id = u.rol_id
     WHERE u.email = ? LIMIT 1`, [botEmail]
  );
  if (rows.length) return rows[0];
  const [roles] = await db.execute(
    `SELECT id FROM roles WHERE nombre = 'Operario' LIMIT 1`
  );
  const roleId = roles[0]?.id || 1;
  const [ins] = await db.execute(
    `INSERT INTO usuarios (nombre, email, rol_id, activo, password_hash) VALUES (?,?,?,1,'bot-user')`,
    [`WA-${phone}`, botEmail, roleId]
  );
  return { id: ins.insertId, nombre: `WA-${phone}`, email: botEmail, rol_nombre: 'Operario' };
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
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS cnt FROM aprobaciones`
  );
  return `REQ-${String((rows[0].cnt || 0) + 1).padStart(6, '0')}`;
}

async function upsertStock(db, { producto_id, bodega_id, lote, cantidad }) {
  const [ex] = await db.execute(
    `SELECT id FROM stock
     WHERE producto_id=? AND bodega_id=? AND (lote=? OR (lote IS NULL AND ? IS NULL)) LIMIT 1`,
    [producto_id, bodega_id, lote, lote]
  );
  if (ex.length) {
    await db.execute(
      `UPDATE stock SET cantidad = cantidad + ? WHERE id = ?`, [cantidad, ex[0].id]
    );
  } else {
    await db.execute(
      `INSERT INTO stock (producto_id, bodega_id, lote, cantidad) VALUES (?,?,?,?)`,
      [producto_id, bodega_id, lote || null, cantidad]
    );
  }
}

/**
 * Ejecuta el payload de una solicitud aprobada.
 * Centraliza toda la lógica de aprobación en un solo lugar.
 */
async function executeApprovedPayload(db, { accion, payload, aprobador_id, bodegaId }) {
  switch (accion) {

    case 'SOLICITAR_CIERRE_PRODUCCION': {
      const [rows] = await db.execute(
        `SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1`, [payload.order_id]
      );
      if (!rows.length) throw { status: 404, message: `Orden #${payload.order_id} no encontrada` };
      const cantReal = payload.qty_real || rows[0].cantidad_obj;
      await db.execute(
        `UPDATE ordenes_produccion SET estado='completada', cantidad_prod=?, updated_at=NOW() WHERE id=?`,
        [cantReal, payload.order_id]
      );
      const lpnOP = `L-OP${payload.order_id}-${Date.now()}`;
      const lotId = await createLot(db, {
        lpn: lpnOP, product_id: rows[0].producto_id, bodega_id: bodegaId,
        qty: cantReal, origin: 'PRODUCCION', received_by: aprobador_id,
        notes: `Orden de producción #${payload.order_id}`,
      });
      await upsertStock(db, { producto_id: rows[0].producto_id, bodega_id: bodegaId, lote: lpnOP, cantidad: cantReal });
      await db.execute(
        `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
         VALUES ('entrada',?,?,?,?,?,'orden_produccion',?)`,
        [rows[0].producto_id, bodegaId, lpnOP, cantReal, payload.order_id, aprobador_id]
      );
      const balance = await getStockBalance(db, rows[0].producto_id, bodegaId);
      await logKardex(db, {
        product_id: rows[0].producto_id, user_id: aprobador_id,
        action: 'CIERRE_PRODUCCION', qty: cantReal, lot_id: lotId,
        balance_after: balance, reference: `orden_produccion:${payload.order_id}`,
        approved_by: aprobador_id,
      });
      return { lote: lpnOP, cantidad: cantReal };
    }

    case 'SOLICITAR_DESPACHO': {
      const cantDesp  = Number(payload.qty) || 0;
      const lotIdDesp = await lotIdByLpn(db, payload.lpn);
      if (payload.lpn) {
        await db.execute(
          `UPDATE stock SET cantidad = GREATEST(0, cantidad - ?) WHERE producto_id=? AND bodega_id=? AND lote=? LIMIT 1`,
          [cantDesp, payload.product_id, bodegaId, payload.lpn]
        );
        await db.execute(
          `UPDATE lots SET qty_current = GREATEST(0, qty_current - ?),
           status = IF(qty_current - ? <= 0, 'DESPACHADO', status) WHERE lpn = ?`,
          [cantDesp, cantDesp, payload.lpn]
        ).catch(() => {});
      }
      await db.execute(
        `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
         VALUES ('salida',?,?,?,?,'despacho_aprobado',?)`,
        [payload.product_id, bodegaId, payload.lpn || null, cantDesp, aprobador_id]
      );
      const balance = await getStockBalance(db, payload.product_id, bodegaId);
      await logKardex(db, {
        product_id: payload.product_id, user_id: aprobador_id,
        action: 'DESPACHO', qty: -cantDesp, lot_id: lotIdDesp,
        balance_after: balance,
        reference: payload.lpn ? `lote:${payload.lpn}` : null,
        notes: payload.customer ? `Cliente: ${payload.customer}` : null,
        approved_by: aprobador_id,
      });
      return { despachado: cantDesp };
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
  const action   = info['@ction'] || info.action || 'UNKNOWN';
  const params   = info.params || {};
  const priority = info.priority || 'baja';

  const db = await DB();
  try {
    await saveLog(db, { from, action, priority, payload: rawBody, response: null, status: 'RECEIVED' });

    const user     = await getOrCreateBotUser(db, from);
    const bodegaId = await getDefaultBodega(db);

    // ── RBAC: verificar permiso antes de ejecutar ──────────────
    // Normalizar rol_nombre: primera letra mayúscula, resto minúsculas
    // Esto protege contra inconsistencias en la BD (ej: 'operario' vs 'Operario')
    const rolRaw  = user.rol_nombre || '';
    const rolNorm = rolRaw.charAt(0).toUpperCase() + rolRaw.slice(1).toLowerCase();

    const rolesPermitidos = RBAC[action];
    if (rolesPermitidos && !rolesPermitidos.includes(rolNorm)) {
      const msg = `🚫 No tienes permiso para ejecutar *${action}*.\nTu rol: ${rolRaw}`;
      await sendBack(from, msg);
      await saveLog(db, { from, action, priority, payload: rawBody, response: { error: 'RBAC_DENIED' }, status: 'DENIED' });
      return res.status(403).json({ ok: false, error: 'RBAC_DENIED', rol: rolRaw });
    }

    let result = {};

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

        const msg = [
          `✅ *Recepción registrada: ${numero}*`,
          `Producto: ${params.id_item}`,
          `Buenos: ${cantBuena} und → Lote ${lpnBuena}`,
          msgMala,
          params.proveedor ? `Proveedor: ${params.proveedor}` : ''
        ].filter(Boolean).join('\n');
        await sendBack(from, msg);
        result = { message: msg, numero, lote: lpnBuena, lot_id: lotIdBuena };
        break;
      }

      // ── 2. SOLICITAR_INICIO_PRODUCCION ───────────────────────
      case 'SOLICITAR_INICIO_PRODUCCION': {
        const p = await findProductBySku(db, params.id_producto_final);
        const [ins] = await db.execute(
          `INSERT INTO ordenes_produccion (producto_id, cantidad_obj, bodega_id, estado, usuario_id, observaciones)
           VALUES (?,?,?,'borrador',?,?)`,
          [p.id, params.cantidad_planificada, bodegaId, user.id, `Creada desde WhatsApp por ${from}`]
        );
        const orderId = ins.insertId;
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.nombre FROM bom b
           JOIN productos pr ON pr.id = b.insumo_producto_id
           WHERE b.producto_id = ?`, [p.id]
        ).catch(() => [[]]);
        const picking = bom.length
          ? bom.map(b => `  • ${b.siigo_code}: ${parseFloat(b.cantidad_por_unidad) * params.cantidad_planificada} und`).join('\n')
          : '  (Sin BOM — verifica materiales manualmente)';
        const msg = [
          `🏭 *Orden #${orderId} creada*`,
          `Producto: ${params.id_producto_final}`,
          `Cantidad: ${params.cantidad_planificada}`,
          ``, `📋 *Materiales necesarios:*`, picking
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg, orden_id: orderId };
        break;
      }

      // ── 3. AVANCE_FASES ───────────────────────────────────────
      case 'AVANCE_FASES': {
        const [rows] = await db.execute(
          `SELECT id FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        await db.execute(
          `UPDATE ordenes_produccion SET estado='en_proceso',
           observaciones=CONCAT(IFNULL(observaciones,''), ?), updated_at=NOW() WHERE id=?`,
          [`\nFase: ${params.fase_destino} - ${new Date().toISOString()}`, rows[0].id]
        );
        const msg = `📦 *Avance registrado*\nOrden #${params.id_orden}\nFase: ${params.fase_destino}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      // ── 4. REPORTE_MERMA ──────────────────────────────────────
      case 'REPORTE_MERMA': {
        const p = await findProductBySku(db, params.id_item);
        const cantMerma  = Math.abs(Number(params.cantidad));
        const lotIdMerma = await lotIdByLpn(db, params.id_lote);
        await db.execute(
          `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
           VALUES ('ajuste',?,?,?,?,'merma_wa',?)`,
          [p.id, bodegaId, params.id_lote || null, -cantMerma, user.id]
        );
        if (params.id_lote) {
          await db.execute(
            `UPDATE stock SET cantidad = GREATEST(0, cantidad - ?) WHERE producto_id=? AND lote=?`,
            [cantMerma, p.id, params.id_lote]
          );
          await db.execute(
            `UPDATE lots SET qty_current = GREATEST(0, qty_current - ?),
             status = IF(qty_current - ? <= 0, 'AGOTADO', status) WHERE lpn = ?`,
            [cantMerma, cantMerma, params.id_lote]
          ).catch(() => {});
        }
        const balance = await getStockBalance(db, p.id, bodegaId);
        await logKardex(db, {
          product_id: p.id, user_id: user.id, action: 'MERMA_BODEGA',
          qty: -cantMerma, lot_id: lotIdMerma, balance_after: balance,
          reference: params.id_lote ? `lote:${params.id_lote}` : null,
          notes: params.motivo || null,
        });
        const msg = [
          `⚠️ *Merma registrada*`,
          `Producto: ${params.id_item}`,
          `Cantidad: ${cantMerma}`,
          `Motivo: ${params.motivo || 'No especificado'}`
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      // ── 5. SOLICITAR_CIERRE_PRODUCCION → encolar ─────────────
      case 'SOLICITAR_CIERRE_PRODUCCION': {
        const [rows] = await db.execute(
          `SELECT * FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_CIERRE_PRODUCCION', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            order_id: rows[0].id, qty_real: params.cantidad_real,
            operario_phone: from
          }), user.id]
        );
        // Notificar supervisor
        const [supervisors] = await db.execute(
          `SELECT u.email FROM usuarios u JOIN roles r ON r.id=u.rol_id
           WHERE r.nombre IN ('Supervisor','Admin') AND u.activo=1 LIMIT 3`
        ).catch(() => [[]]);
        for (const s of supervisors) {
          await sendBack(s.email.replace('@wa.bot',''), [
            `🔔 *Solicitud pendiente: ${codigo}*`,
            `Acción: Cierre de producción`,
            `Orden: ${params.id_orden}`,
            `Operario: ${user.nombre}`,
            `Para aprobar: _APROBAR ${codigo}_`
          ].join('\n'));
        }
        const msg = [
          `⏳ *Solicitud enviada: ${codigo}*`,
          `Orden: ${params.id_orden}`,
          `Cantidad real: ${params.cantidad_real}`,
          `Esperando aprobación del supervisor.`
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg, codigo_solicitud: codigo };
        break;
      }

      // ── 6. SOLICITAR_DESPACHO → encolar ──────────────────────
      case 'SOLICITAR_DESPACHO': {
        const lot = await lotIdByLpn(db, params.id_lote);
        const p   = await findProductBySku(db, params.id_item);
        const codigo = await nextSolicitudCodigo(db);
        await db.execute(
          `INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, creado_en)
           VALUES (?, 'SOLICITAR_DESPACHO', ?, ?, 'PENDIENTE', NOW())`,
          [codigo, JSON.stringify({
            lot_id: lot, lpn: params.id_lote, product_id: p.id,
            qty: params.cantidad, customer: params.cliente_destino,
            operario_phone: from
          }), user.id]
        );
        const [supervisors] = await db.execute(
          `SELECT u.email FROM usuarios u JOIN roles r ON r.id=u.rol_id
           WHERE r.nombre IN ('Supervisor','Admin') AND u.activo=1 LIMIT 3`
        ).catch(() => [[]]);
        for (const s of supervisors) {
          await sendBack(s.email.replace('@wa.bot',''), [
            `🔔 *Solicitud pendiente: ${codigo}*`,
            `Acción: Despacho`,
            `Lote: ${params.id_lote}  |  Cant: ${params.cantidad}`,
            `Cliente: ${params.cliente_destino || 'N/A'}`,
            `Para aprobar: _APROBAR ${codigo}_`
          ].join('\n'));
        }
        const msg = [
          `⏳ *Solicitud de despacho: ${codigo}*`,
          `Lote: ${params.id_lote}`,
          `Cantidad: ${params.cantidad}`,
          `Esperando aprobación.`
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg, codigo_solicitud: codigo };
        break;
      }

      // ── 7. GESTION_DEVOLUCION ─────────────────────────────────
      case 'GESTION_DEVOLUCION': {
        const p       = await findProductBySku(db, params.id_item);
        const lpnDev  = `L-DEV-${p.siigo_code}-${Date.now()}`;
        const numero  = await nextRecepcionNumero(db);
        const [recIns] = await db.execute(
          `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id, observaciones)
           VALUES (?,?,?,'completada',?,?)`,
          [numero, bodegaId, params.cliente_origen || null, user.id,
           `Devolución - ${params.estado || 'CUARENTENA'}`]
        );
        await db.execute(
          `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
           VALUES (?,?,?,?,?)`,
          [recIns.insertId, p.id, lpnDev, params.cantidad, params.cantidad]
        );
        await upsertStock(db, { producto_id: p.id, bodega_id: bodegaId, lote: lpnDev, cantidad: params.cantidad });
        const lotIdDev = await createLot(db, {
          lpn: lpnDev, product_id: p.id, bodega_id: bodegaId,
          qty: params.cantidad, origin: 'DEVOLUCION', received_by: user.id,
          notes: `Cliente: ${params.cliente_origen || 'N/A'} | Estado: ${params.estado || 'CUARENTENA'}`,
        });
        const balance = await getStockBalance(db, p.id, bodegaId);
        await logKardex(db, {
          product_id: p.id, user_id: user.id, action: 'DEVOLUCION',
          qty: params.cantidad, lot_id: lotIdDev, balance_after: balance,
          reference: `recepcion:${numero}`,
          notes: `Cliente: ${params.cliente_origen || 'N/A'} | Estado: ${params.estado || 'CUARENTENA'}`,
        });
        const msg = [
          `🔄 *Devolución registrada*`,
          `Producto: ${params.id_item}`,
          `Cantidad: ${params.cantidad}`,
          `Lote: ${lpnDev}`
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg, lote: lpnDev, lot_id: lotIdDev };
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

        // Ejecutar la acción real
        const execResult = await executeApprovedPayload(db, {
          accion:      solicitud.accion,
          payload,
          aprobador_id: user.id,
          bodegaId,
        });

        await db.execute(
          `UPDATE aprobaciones SET estado='APROBADO', procesado_por=?, procesado_en=NOW() WHERE codigo_solicitud=?`,
          [user.id, params.id_solicitud]
        );

        // Notificar al operario
        if (payload.operario_phone) {
          await sendBack(payload.operario_phone, [
            `✅ *Tu solicitud fue aprobada*`,
            `ID: ${params.id_solicitud}`,
            `Acción: ${solicitud.accion.replace(/_/g,' ')}`,
            `Aprobado por: ${user.nombre}`
          ].join('\n'));
        }

        await logSystemEvent(db, { modulo: 'aprobaciones', nivel: 'INFO',
          mensaje: `Solicitud ${params.id_solicitud} aprobada`,
          usuario_id: user.id, payload: execResult });

        const msg = [
          `✅ *${params.id_solicitud} Aprobada*`,
          `Acción: ${solicitud.accion.replace(/_/g,' ')}`,
          JSON.stringify(execResult)
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg, ...execResult };
        break;
      }

      // ── 9. RECHAZAR_SOLICITUD ─────────────────────────────────
      case 'RECHAZAR_SOLICITUD': {
        const [rows] = await db.execute(
          `SELECT * FROM aprobaciones WHERE codigo_solicitud = ? AND estado = 'PENDIENTE' LIMIT 1`,
          [params.id_solicitud]
        );
        if (!rows.length) throw { status: 404, message: `Solicitud ${params.id_solicitud} no encontrada o ya procesada` };
        const solicitud = rows[0];
        const payload   = typeof solicitud.payload === 'string'
          ? JSON.parse(solicitud.payload) : solicitud.payload;

        await db.execute(
          `UPDATE aprobaciones SET estado='RECHAZADO', procesado_por=?, procesado_en=NOW(),
           motivo_rechazo=? WHERE codigo_solicitud=?`,
          [user.id, params.motivo || null, params.id_solicitud]
        );

        if (payload.operario_phone) {
          await sendBack(payload.operario_phone, [
            `❌ *Tu solicitud fue rechazada*`,
            `ID: ${params.id_solicitud}`,
            params.motivo ? `Motivo: ${params.motivo}` : ''
          ].filter(Boolean).join('\n'));
        }

        await logSystemEvent(db, { modulo: 'aprobaciones', nivel: 'WARN',
          mensaje: `Solicitud ${params.id_solicitud} rechazada`,
          usuario_id: user.id, payload: { motivo: params.motivo } });

        const msg = [
          `❌ *${params.id_solicitud} Rechazada*`,
          params.motivo ? `Motivo: ${params.motivo}` : ''
        ].filter(Boolean).join('\n');
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      // ── 10. AJUSTE_INVENTARIO ─────────────────────────────────
      case 'AJUSTE_INVENTARIO': {
        const p    = await findProductBySku(db, params.id_item);
        const diff = Number(params.cantidad);  // positivo = entrada, negativo = salida
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
        const msg = [
          `🔧 *Ajuste registrado*`,
          `Producto: ${params.id_item}`,
          `Ajuste: ${diff > 0 ? '+' : ''}${diff} und`,
          `Saldo nuevo: ${balance} und`,
          params.motivo ? `Motivo: ${params.motivo}` : ''
        ].filter(Boolean).join('\n');
        await sendBack(from, msg);
        result = { message: msg, balance };
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
        const msg = `📋 *Solicitudes pendientes:*\n${lines}`;
        await sendBack(from, msg);
        result = { message: msg, pendientes: rows.length };
        break;
      }

      // ── Consultas ─────────────────────────────────────────────
      case 'CONSULTAR_STOCK_MATERIA_PRIMA':
      case 'CONSULTAR_STOCK_PRODUCTO_TERMINADO': {
        if (params.id_item) {
          const p = await findProductBySku(db, params.id_item);
          const [rows] = await db.execute(
            `SELECT COALESCE(SUM(cantidad),0) AS disp, COALESCE(SUM(reservada),0) AS res, COUNT(*) AS lotes
             FROM stock WHERE producto_id=? AND bodega_id=?`, [p.id, bodegaId]
          );
          const msg = [
            `📊 *Stock: ${params.id_item}*`,
            `Disponible: ${rows[0].disp} und`,
            `Reservado: ${rows[0].res} und`,
            `Lotes: ${rows[0].lotes}`
          ].join('\n');
          await sendBack(from, msg);
          result = { message: msg };
        } else {
          const [rows] = await db.execute(
            `SELECT p.siigo_code, p.nombre, COALESCE(SUM(s.cantidad),0) AS stock
             FROM productos p LEFT JOIN stock s ON s.producto_id=p.id AND s.bodega_id=?
             WHERE p.activo=1 GROUP BY p.id ORDER BY stock DESC LIMIT 10`, [bodegaId]
          );
          const lines = rows.map(r => `  • ${r.siigo_code}: ${r.stock} und`).join('\n');
          const msg   = `📦 *Stock top 10:*\n${lines || '  (Sin stock registrado)'}`;
          await sendBack(from, msg);
          result = { message: msg };
        }
        break;
      }

      case 'CONSULTAR_ESTADO_PRODUCCION': {
        const [rows] = await db.execute(
          `SELECT o.*, p.nombre AS producto, p.siigo_code
           FROM ordenes_produccion o JOIN productos p ON p.id=o.producto_id
           WHERE o.id = ? OR o.codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const o = rows[0];
        const msg = [
          `🔍 *Orden: ${params.id_orden}*`,
          `Producto: ${o.producto} (${o.siigo_code})`,
          `Estado: ${o.estado}`,
          `Planificado: ${o.cantidad_obj}`,
          `Producido: ${o.cantidad_prod || 'en proceso'}`
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_TRAZABILIDAD_LOTE': {
        const [lotRows] = await db.execute(
          `SELECT l.*, p.nombre, p.siigo_code
           FROM lots l JOIN productos p ON p.id = l.product_id
           WHERE l.lpn = ? LIMIT 1`, [params.id_lote]
        ).catch(() => [[]]);
        if (lotRows.length) {
          const l = lotRows[0];
          const [kRows] = await db.execute(
            `SELECT action, qty, balance_after, created_at FROM kardex
             WHERE lot_id = ? ORDER BY created_at ASC`, [l.id]
          ).catch(() => [[]]);
          const history = kRows.length
            ? kRows.map(k => `  ${k.action}: ${k.qty > 0 ? '+' : ''}${k.qty} (saldo: ${k.balance_after})`).join('\n')
            : '  (Sin movimientos en kardex)';
          const msg = [
            `🔎 *Lote: ${params.id_lote}*`,
            `Producto: ${l.nombre} (${l.siigo_code})`,
            `Inicial: ${l.qty_initial} und`,
            `Actual: ${l.qty_current} und`,
            `Estado: ${l.status}  |  Origen: ${l.origin}`,
            `Vence: ${l.expiry_date || 'N/A'}`,
            ``, `📋 *Historial:*`, history
          ].join('\n');
          await sendBack(from, msg);
          result = { message: msg };
        } else {
          const [rows] = await db.execute(
            `SELECT s.*, p.nombre, p.siigo_code FROM stock s
             JOIN productos p ON p.id=s.producto_id WHERE s.lote = ? LIMIT 1`,
            [params.id_lote]
          );
          if (!rows.length) throw { status: 404, message: `Lote "${params.id_lote}" no encontrado` };
          const s   = rows[0];
          const msg = [
            `🔎 *Lote: ${params.id_lote}*`,
            `Producto: ${s.nombre} (${s.siigo_code})`,
            `Cantidad: ${s.cantidad} und`,
            `Vence: ${s.fecha_venc || 'N/A'}`
          ].join('\n');
          await sendBack(from, msg);
          result = { message: msg };
        }
        break;
      }

      case 'CONSULTAR_CAPACIDAD_FABRICACION': {
        const p = await findProductBySku(db, params.id_producto_final);
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.id AS insumo_id FROM bom b
           JOIN productos pr ON pr.id=b.insumo_producto_id WHERE b.producto_id=?`, [p.id]
        ).catch(() => [[]]);
        let puedeProd = true;
        const checks  = [];
        for (const item of bom) {
          const needed = parseFloat(item.cantidad_por_unidad) * params.cantidad_deseada;
          const [st]   = await db.execute(
            `SELECT COALESCE(SUM(cantidad),0) AS stock FROM stock WHERE producto_id=? AND bodega_id=?`,
            [item.insumo_id, bodegaId]
          );
          const ok = parseFloat(st[0].stock) >= needed;
          if (!ok) puedeProd = false;
          checks.push(`  ${ok ? '✅' : '❌'} ${item.siigo_code}: necesita ${needed}, tiene ${st[0].stock}`);
        }
        const msg = [
          `${puedeProd ? '✅' : '❌'} *Capacidad para ${params.cantidad_deseada} uds de ${params.id_producto_final}:*`,
          ...checks
        ].join('\n');
        await sendBack(from, msg);
        result = { message: msg, can_produce: puedeProd };
        break;
      }

      case 'CONFIRMAR_MATERIALES_PRODUCCION':
      case 'EXCEPCION_PICKING': {
        const [rows] = await db.execute(
          `SELECT id FROM ordenes_produccion WHERE id = ? OR codigo_orden = ? LIMIT 1`,
          [params.id_orden, params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        await db.execute(
          `UPDATE ordenes_produccion SET estado='en_proceso', updated_at=NOW() WHERE id=?`,
          [rows[0].id]
        );
        const msg = [
          `✅ *Materiales confirmados*`,
          `Orden: ${params.id_orden} → En proceso`,
          action === 'EXCEPCION_PICKING' && params.lote_usado
            ? `Lote alternativo: ${params.lote_usado}` : ''
        ].filter(Boolean).join('\n');
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'MODO_CHARLA': {
        const msg = params.texto || 'No entendí tu mensaje. ¿Puedes ser más específico?';
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      default:
        throw { status: 400, message: `Acción desconocida: ${action}` };
    }

    await saveLog(db, { from, action, priority, payload: rawBody, response: result, status: 'PROCESSED' });
    return res.json({ ok: true, ...result });

  } catch (err) {
    const errMsg = err.message || 'Error interno';
    await saveLog(db, { from, action, priority, payload: rawBody,
      response: { error: errMsg }, status: 'ERROR' }).catch(() => {});
    return res.status(err.status || 500).json({ ok: false, error: errMsg });
  } finally {
    await db.end().catch(() => {});
  }
};
