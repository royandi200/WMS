// Vercel Serverless Function
// POST /api/v1/webhook/builderbot
const mysql = require('mysql2/promise');
const axios = require('axios');

// ─────────────────────────────────────────────
const DB = () => mysql.createConnection({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || 'kainotomia_WMS'
});

// ─────────────────────────────────────────────
async function saveLog(db, { from, action, priority, payload, response, status }) {
  await db.execute(
    `INSERT INTO webhook_logs (from_phone, action, priority, payload, response, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [from || null, action, priority || 'baja',
     JSON.stringify(payload), JSON.stringify(response || {}), status]
  );
}

// ─────────────────────────────────────────────
async function sendBack(phone, text) {
  if (!process.env.BUILDERBOT_SEND_URL) return;
  await axios.post(process.env.BUILDERBOT_SEND_URL,
    { phone, message: text },
    { headers: { 'x-api-key': process.env.BUILDERBOT_API_KEY || '' }, timeout: 8000 }
  ).catch(() => {});
}

// ─────────────────────────────────────────────
async function findProductBySku(db, sku) {
  // Busca en skus primero
  const [rows] = await db.execute(
    `SELECT p.* FROM productos p
     INNER JOIN skus s ON s.producto_id = p.id
     WHERE s.sku = ? AND s.activo = 1 AND p.activo = 1
     LIMIT 1`, [sku]
  );
  if (rows.length) return rows[0];
  // Fallback: siigo_code directo
  const [rows2] = await db.execute(
    `SELECT * FROM productos WHERE siigo_code = ? AND activo = 1 LIMIT 1`, [sku]
  );
  if (!rows2.length) throw { status: 404, message: `Producto "${sku}" no encontrado` };
  return rows2[0];
}

async function findLotByLpn(db, lpn) {
  const [rows] = await db.execute(`SELECT * FROM lotes WHERE lpn = ? LIMIT 1`, [lpn]);
  if (!rows.length) throw { status: 404, message: `Lote "${lpn}" no encontrado` };
  return rows[0];
}

async function resolveOrderId(db, orderCode) {
  const [rows] = await db.execute(
    `SELECT id FROM ordenes_produccion WHERE order_code = ? LIMIT 1`, [orderCode]
  );
  if (!rows.length) throw { status: 404, message: `Orden "${orderCode}" no encontrada` };
  return rows[0].id;
}

async function getOrCreateBotUser(db, phone) {
  const [rows] = await db.execute(`SELECT * FROM usuarios WHERE phone = ? LIMIT 1`, [phone]);
  if (rows.length) return rows[0];
  const [roles] = await db.execute(`SELECT id FROM roles WHERE nombre = 'Operario' LIMIT 1`);
  const roleId = roles[0]?.id || 1;
  const [ins] = await db.execute(
    `INSERT INTO usuarios (nombre, phone, rol_id, activo, password_hash) VALUES (?,?,?,1,'bot-user')`,
    [`WA-${phone}`, phone, roleId]
  );
  return { id: ins.insertId, nombre: `WA-${phone}`, phone };
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { from, info } = req.body || {};
  const action   = info?.['@ction'] || 'UNKNOWN';
  const params   = info?.params || {};
  const priority = info?.priority || 'baja';
  // kw es la keyword interna de BuilderBot que activó el flujo (solo dato informativo)
  const kw = info?.kw || null;

  const db = await DB();
  try {
    // Log de entrada
    await saveLog(db, { from, action, priority, payload: req.body, response: null, status: 'RECEIVED' });

    const user = await getOrCreateBotUser(db, from);
    let result = {};

    switch (action) {

      case 'INGRESO_RECEPCION': {
        const p = await findProductBySku(db, params.id_item);
        const lpn = `LPN-${p.siigo_code || p.id}-${Date.now()}`;
        const qtyBuena = (params.cantidad || 0) - (params.cantidad_mala || 0);
        await db.execute(
          `INSERT INTO lotes (producto_id, lpn, cantidad_inicial, cantidad_actual, estado, proveedor_nombre, creado_por)
           VALUES (?,?,?,?,'DISPONIBLE',?,?)`,
          [p.id, lpn, qtyBuena, qtyBuena, params.proveedor || null, user.id]
        );
        if ((params.cantidad_mala || 0) > 0) {
          const lpnMalo = `LPN-${p.siigo_code || p.id}-NOV-${Date.now()}`;
          await db.execute(
            `INSERT INTO lotes (producto_id, lpn, cantidad_inicial, cantidad_actual, estado, proveedor_nombre, creado_por)
             VALUES (?,?,?,?,'CUARENTENA',?,?)`,
            [p.id, lpnMalo, params.cantidad_mala, params.cantidad_mala, params.proveedor || null, user.id]
          );
        }
        const msg = `✅ *Recepción registrada*\nProducto: ${params.id_item}\nBuenos: ${qtyBuena}\nNovedad: ${params.cantidad_mala || 0}\nLote: ${lpn}`;
        await sendBack(from, msg);
        result = { message: msg, lpn };
        break;
      }

      case 'SOLICITAR_INICIO_PRODUCCION': {
        const p = await findProductBySku(db, params.id_producto_final);
        const orderCode = `ORD-${Date.now()}`;
        await db.execute(
          `INSERT INTO ordenes_produccion (order_code, producto_id, cantidad_planificada, estado, fase, creado_por)
           VALUES (?,?,?,'PENDIENTE_MATERIALES','F0',?)`,
          [orderCode, p.id, params.cantidad_planificada, user.id]
        );
        // Obtener BOM
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.nombre
           FROM bom b JOIN productos pr ON pr.id = b.insumo_producto_id
           WHERE b.producto_id = ?`, [p.id]
        );
        const picking = bom.length
          ? bom.map(b => `  • ${b.siigo_code}: ${parseFloat(b.cantidad_por_unidad) * params.cantidad_planificada} ${b.unidad || 'und'}`).join('\n')
          : '  (No hay BOM configurado)';
        const msg = `🏭 *Orden creada: ${orderCode}*\nProducto: ${params.id_producto_final}\nCantidad: ${params.cantidad_planificada}\n\n📋 *Lista de recolección (FIFO):*\n${picking}\n\nCuando tengas los materiales responde:\n✅ _Confirmo materiales para ${orderCode}_`;
        await sendBack(from, msg);
        result = { message: msg, order_code: orderCode };
        break;
      }

      case 'AVANCE_FASES': {
        const orderId = await resolveOrderId(db, params.id_orden);
        await db.execute(
          `UPDATE ordenes_produccion SET fase=?, estado='EN_PROCESO', actualizado_por=? WHERE id=?`,
          [params.fase_destino, user.id, orderId]
        );
        const fases = { F1:'Llenado', F2:'Sellado', F3:'Tapado', F4:'Etiquetado', F5:'Embalaje' };
        const msg = `📦 *Avance registrado*\nOrden: ${params.id_orden}\nFase: ${params.fase_destino} — ${fases[params.fase_destino] || ''}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'REPORTE_MERMA': {
        const p = await findProductBySku(db, params.id_item);
        const tipo = params.id_orden ? 'MERMA_EN_MAQUINA' : 'MERMA_EN_ESTANTERIA';
        const mermaCode = `MRM-${Date.now()}`;
        await db.execute(
          `INSERT INTO mermas (merma_code, tipo, producto_id, cantidad, motivo, orden_code, lote_lpn, creado_por)
           VALUES (?,?,?,?,?,?,?,?)`,
          [mermaCode, tipo, p.id, params.cantidad, params.motivo, params.id_orden || null, params.id_lote || null, user.id]
        );
        const msg = `⚠️ *Merma registrada: ${mermaCode}*\nProducto: ${params.id_item}\nCantidad: ${params.cantidad}\nMotivo: ${params.motivo}`;
        await sendBack(from, msg);
        result = { message: msg, merma_code: mermaCode };
        break;
      }

      case 'SOLICITAR_CIERRE_PRODUCCION':
      case 'SOLICITAR_DESPACHO': {
        const reqCode = `REQ-${Date.now()}`;
        const payload = action === 'SOLICITAR_CIERRE_PRODUCCION'
          ? { order_code: params.id_orden, qty_real: params.cantidad_real }
          : { lote_lpn: params.id_lote, qty: params.cantidad, cliente: params.cliente_destino };
        await db.execute(
          `INSERT INTO cola_aprobaciones (request_code, accion, payload, solicitado_por, estado, prioridad)
           VALUES (?,?,?,?,?,?)`,
          [reqCode, action, JSON.stringify(payload), user.id, 'PENDIENTE', priority]
        );
        const msg = `⏳ *Solicitud enviada: ${reqCode}*\n${action === 'SOLICITAR_CIERRE_PRODUCCION' ? 'Orden: '+params.id_orden+'\nCantidad real: '+params.cantidad_real : 'Lote: '+params.id_lote+'\nCantidad: '+params.cantidad+'\nCliente: '+params.cliente_destino}\nEsperando aprobación del Validador.`;
        await sendBack(from, msg);
        result = { message: msg, request_code: reqCode };
        break;
      }

      case 'GESTION_DEVOLUCION': {
        const p = await findProductBySku(db, params.id_item);
        const lpn = `LPN-DEV-${p.siigo_code || p.id}-${Date.now()}`;
        const estado = params.estado === 'RECUPERABLE' ? 'RECUPERABLE' : 'CUARENTENA';
        await db.execute(
          `INSERT INTO lotes (producto_id, lpn, cantidad_inicial, cantidad_actual, estado, notas, creado_por)
           VALUES (?,?,?,?,?,?,?)`,
          [p.id, lpn, params.cantidad, params.cantidad, estado, `Devolución de ${params.cliente_origen}`, user.id]
        );
        const msg = `🔄 *Devolución registrada*\nProducto: ${params.id_item}\nCantidad: ${params.cantidad}\nEstado: ${estado}\nLote: ${lpn}`;
        await sendBack(from, msg);
        result = { message: msg, lpn };
        break;
      }

      case 'APROBAR_SOLICITUD': {
        const [rows] = await db.execute(
          `SELECT * FROM cola_aprobaciones WHERE request_code = ? LIMIT 1`, [params.id_solicitud]
        );
        if (!rows.length) throw { status: 404, message: `Solicitud ${params.id_solicitud} no encontrada` };
        await db.execute(
          `UPDATE cola_aprobaciones SET estado='APROBADA', aprobado_por=?, aprobado_en=NOW() WHERE request_code=?`,
          [user.id, params.id_solicitud]
        );
        const msg = `✅ *${params.id_solicitud} Aprobada*\nAcción: ${rows[0].accion?.replace(/_/g,' ')}\nAprobado por: ${user.nombre}`;
        await sendBack(from, msg);
        // Notificar al solicitante original
        const [sol] = await db.execute(`SELECT phone FROM usuarios WHERE id=? LIMIT 1`, [rows[0].solicitado_por]);
        if (sol[0]?.phone && sol[0].phone !== from) await sendBack(sol[0].phone, msg);
        result = { message: msg };
        break;
      }

      case 'RECHAZAR_SOLICITUD': {
        await db.execute(
          `UPDATE cola_aprobaciones SET estado='RECHAZADA', aprobado_por=?, aprobado_en=NOW(), motivo_rechazo=? WHERE request_code=?`,
          [user.id, params.motivo || null, params.id_solicitud]
        );
        const msg = `❌ *${params.id_solicitud} Rechazada*${params.motivo ? '\nMotivo: '+params.motivo : ''}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_STOCK_MATERIA_PRIMA':
      case 'CONSULTAR_STOCK_PRODUCTO_TERMINADO': {
        if (params.id_item) {
          const p = await findProductBySku(db, params.id_item);
          const [rows] = await db.execute(
            `SELECT COALESCE(SUM(cantidad_actual),0) AS disp, COUNT(*) AS lotes
             FROM lotes WHERE producto_id=? AND estado='DISPONIBLE'`, [p.id]
          );
          const msg = `📊 *Stock: ${params.id_item}*\nDisponible: ${rows[0].disp} und\nLotes activos: ${rows[0].lotes}`;
          await sendBack(from, msg);
          result = { message: msg };
        } else {
          const [rows] = await db.execute(
            `SELECT p.siigo_code, p.nombre, COALESCE(SUM(l.cantidad_actual),0) AS stock
             FROM productos p LEFT JOIN lotes l ON l.producto_id=p.id AND l.estado='DISPONIBLE'
             WHERE p.activo=1 GROUP BY p.id ORDER BY stock DESC LIMIT 10`
          );
          const lines = rows.map(r => `  • ${r.siigo_code}: ${r.stock} und`).join('\n');
          const msg = `📦 *Resumen de stock (top 10):*\n${lines}`;
          await sendBack(from, msg);
          result = { message: msg };
        }
        break;
      }

      case 'CONSULTAR_ESTADO_PRODUCCION': {
        const [rows] = await db.execute(
          `SELECT o.*, p.nombre AS producto FROM ordenes_produccion o
           JOIN productos p ON p.id=o.producto_id
           WHERE o.order_code=? LIMIT 1`, [params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden ${params.id_orden} no encontrada` };
        const o = rows[0];
        const fases = { F0:'Pendiente materiales', F1:'Llenado', F2:'Sellado', F3:'Tapado', F4:'Etiquetado', F5:'Embalaje' };
        const msg = `🔍 *Orden: ${params.id_orden}*\nProducto: ${o.producto}\nEstado: ${o.estado}\nFase: ${o.fase} — ${fases[o.fase]||''}\nPlanificado: ${o.cantidad_planificada}\nReal: ${o.cantidad_real || 'en proceso'}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_TRAZABILIDAD_LOTE': {
        const lot = await findLotByLpn(db, params.id_lote);
        const [prod] = await db.execute(`SELECT nombre FROM productos WHERE id=? LIMIT 1`, [lot.producto_id]);
        const msg = `🔎 *Trazabilidad: ${params.id_lote}*\nProducto: ${prod[0]?.nombre || ''}\nEstado: ${lot.estado}\nCantidad inicial: ${lot.cantidad_inicial}\nCantidad actual: ${lot.cantidad_actual}\nVence: ${lot.fecha_vencimiento || 'N/A'}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_CAPACIDAD_FABRICACION': {
        const p = await findProductBySku(db, params.id_producto_final);
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code FROM bom b JOIN productos pr ON pr.id=b.insumo_producto_id WHERE b.producto_id=?`, [p.id]
        );
        let canProduce = true;
        const checks = [];
        for (const item of bom) {
          const needed = parseFloat(item.cantidad_por_unidad) * params.cantidad_deseada;
          const [[{ stock }]] = await db.execute(
            `SELECT COALESCE(SUM(cantidad_actual),0) AS stock FROM lotes WHERE producto_id=? AND estado='DISPONIBLE'`,
            [item.insumo_producto_id]
          );
          const ok = stock >= needed;
          if (!ok) canProduce = false;
          checks.push(`  ${ok?'✅':'❌'} ${item.siigo_code}: necesita ${needed}, tiene ${stock}`);
        }
        const msg = `${canProduce?'✅':'❌'} *Capacidad para ${params.cantidad_deseada} uds de ${params.id_producto_final}:*\n${checks.join('\n') || '  (Sin BOM configurado)'}`;
        await sendBack(from, msg);
        result = { message: msg, can_produce: canProduce };
        break;
      }

      case 'CONFIRMAR_MATERIALES_PRODUCCION':
      case 'EXCEPCION_PICKING': {
        const orderId = await resolveOrderId(db, params.id_orden);
        await db.execute(
          `UPDATE ordenes_produccion SET estado='EN_PROCESO', fase='F1', actualizado_por=? WHERE id=?`,
          [user.id, orderId]
        );
        const msg = `✅ *Materiales confirmados*\nOrden: ${params.id_orden}\nFase: F1 — Llenado${params.lote_usado ? '\nLote usado: '+params.lote_usado : ''}`;
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

    // Log de respuesta exitosa
    await saveLog(db, { from, action, priority, payload: req.body, response: result, status: 'PROCESSED' });
    return res.json({ ok: true, ...result });

  } catch (err) {
    const errMsg = err.message || 'Error interno';
    await saveLog(db, { from, action, priority, payload: req.body, response: { error: errMsg }, status: 'ERROR' }).catch(()=>{});
    return res.status(err.status || 500).json({ ok: false, error: errMsg });
  } finally {
    await db.end().catch(()=>{});
  }
};
