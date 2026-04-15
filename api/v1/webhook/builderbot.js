// Vercel Serverless Function
// POST /api/v1/webhook/builderbot
// Schema real: recepciones, recepcion_items, stock, ordenes_produccion, movimientos
const mysql = require('mysql2/promise');
const axios = require('axios');

const DB = () => mysql.createConnection({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'kainotomia_WMS',
  connectTimeout: 10000,
});

// ──── HELPERS ────

async function saveLog(db, { from, action, priority, payload, response, status }) {
  await db.execute(
    `INSERT INTO webhook_logs (from_phone, action, priority, payload, response, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [from || null, action, priority || 'baja',
     JSON.stringify(payload), JSON.stringify(response || {}), status]
  ).catch(() => {});
}

async function sendBack(phone, text) {
  if (!process.env.BUILDERBOT_SEND_URL) return;
  await axios.post(process.env.BUILDERBOT_SEND_URL,
    { phone, message: text },
    { headers: { 'x-api-key': process.env.BUILDERBOT_API_KEY || '' }, timeout: 8000 }
  ).catch(() => {});
}

async function findProductBySku(db, sku) {
  // Busca por SKU en tabla skus primero
  const [rows] = await db.execute(
    `SELECT p.* FROM productos p
     INNER JOIN skus s ON s.producto_id = p.id
     WHERE s.sku = ? AND p.activo = 1 LIMIT 1`, [sku]
  );
  if (rows.length) return rows[0];
  // Fallback: siigo_code directo
  const [rows2] = await db.execute(
    `SELECT * FROM productos WHERE siigo_code = ? AND activo = 1 LIMIT 1`, [sku]
  );
  if (!rows2.length) throw { status: 404, message: `Producto "${sku}" no encontrado` };
  return rows2[0];
}

async function getDefaultBodega(db) {
  // bodegas usa columna "activa" (no "activo")
  const [rows] = await db.execute(`SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`);
  if (!rows.length) throw { status: 500, message: 'No hay bodegas configuradas' };
  return rows[0].id;
}

async function getOrCreateBotUser(db, phone) {
  const botEmail = `${phone}@wa.bot`;
  const [rows] = await db.execute(`SELECT * FROM usuarios WHERE email = ? LIMIT 1`, [botEmail]);
  if (rows.length) return rows[0];
  const [roles] = await db.execute(`SELECT id FROM roles WHERE nombre = 'Operario' LIMIT 1`);
  const roleId = roles[0]?.id || 1;
  const [ins] = await db.execute(
    `INSERT INTO usuarios (nombre, email, rol_id, activo, password_hash) VALUES (?,?,?,1,'bot-user')`,
    [`WA-${phone}`, botEmail, roleId]
  );
  return { id: ins.insertId, nombre: `WA-${phone}`, email: botEmail };
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

async function upsertStock(db, { producto_id, bodega_id, lote, cantidad }) {
  const [ex] = await db.execute(
    `SELECT id FROM stock WHERE producto_id=? AND bodega_id=? AND (lote=? OR (lote IS NULL AND ? IS NULL)) LIMIT 1`,
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

// ──── HANDLER ────

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
    const user = await getOrCreateBotUser(db, from);
    const bodegaId = await getDefaultBodega(db);
    let result = {};

    switch (action) {

      case 'INGRESO_RECEPCION': {
        const p = await findProductBySku(db, params.id_item);
        const numero = await nextRecepcionNumero(db);
        const cantTotal = Number(params.cantidad) || 0;
        const cantMala  = Number(params.cantidad_mala) || 0;
        const cantBuena = cantTotal - cantMala;
        const loteCode  = `L-${p.siigo_code}-${Date.now()}`;

        const [recIns] = await db.execute(
          `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id)
           VALUES (?,?,?,'completada',?)`,
          [numero, bodegaId, params.proveedor || null, user.id]
        );
        const recepcionId = recIns.insertId;

        if (cantBuena > 0) {
          await db.execute(
            `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
             VALUES (?,?,?,?,?)`,
            [recepcionId, p.id, loteCode, cantBuena, cantBuena]
          );
          await upsertStock(db, { producto_id: p.id, bodega_id: bodegaId, lote: loteCode, cantidad: cantBuena });
          await db.execute(
            `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
             VALUES ('entrada',?,?,?,?,?,'recepcion',?)`,
            [p.id, bodegaId, loteCode, cantBuena, recepcionId, user.id]
          );
        }

        let msgMala = '';
        if (cantMala > 0) {
          const loteNov = `L-NOV-${p.siigo_code}-${Date.now()}`;
          await db.execute(
            `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
             VALUES (?,?,?,?,?)`,
            [recepcionId, p.id, loteNov, cantMala, cantMala]
          );
          msgMala = `\n⚠️ Novedad: ${cantMala} und → Lote ${loteNov}`;
        }

        const msg = `✅ *Recepción registrada: ${numero}*\nProducto: ${params.id_item}\nBuenos: ${cantBuena} und → Lote ${loteCode}${msgMala}${params.proveedor ? '\nProveedor: '+params.proveedor : ''}`;
        await sendBack(from, msg);
        result = { message: msg, numero, lote: loteCode };
        break;
      }

      case 'SOLICITAR_INICIO_PRODUCCION': {
        const p = await findProductBySku(db, params.id_producto_final);
        const [ins] = await db.execute(
          `INSERT INTO ordenes_produccion (producto_id, cantidad_obj, bodega_id, estado, usuario_id, observaciones)
           VALUES (?,?,?,'borrador',?,?)`,
          [p.id, params.cantidad_planificada, bodegaId, user.id, `Creada desde WhatsApp por ${from}`]
        );
        const orderId = ins.insertId;
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.nombre
           FROM bom b JOIN productos pr ON pr.id = b.insumo_producto_id
           WHERE b.producto_id = ?`, [p.id]
        ).catch(() => [[]]);
        const picking = bom.length
          ? bom.map(b => `  • ${b.siigo_code}: ${parseFloat(b.cantidad_por_unidad) * params.cantidad_planificada} und`).join('\n')
          : '  (Sin BOM — verifica materiales manualmente)';
        const msg = `🏭 *Orden #${orderId} creada*\nProducto: ${params.id_producto_final}\nCantidad: ${params.cantidad_planificada}\n\n📋 *Materiales necesarios:*\n${picking}`;
        await sendBack(from, msg);
        result = { message: msg, orden_id: orderId };
        break;
      }

      case 'AVANCE_FASES': {
        const [rows] = await db.execute(`SELECT id FROM ordenes_produccion WHERE id = ? LIMIT 1`, [params.id_orden]);
        if (!rows.length) throw { status: 404, message: `Orden #${params.id_orden} no encontrada` };
        await db.execute(
          `UPDATE ordenes_produccion SET estado='en_proceso',
           observaciones=CONCAT(IFNULL(observaciones,''), ?), updated_at=NOW() WHERE id=?`,
          [`\nFase: ${params.fase_destino} - ${new Date().toISOString()}`, params.id_orden]
        );
        const msg = `📦 *Avance registrado*\nOrden #${params.id_orden}\nFase: ${params.fase_destino}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'REPORTE_MERMA': {
        const p = await findProductBySku(db, params.id_item);
        await db.execute(
          `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
           VALUES ('ajuste',?,?,?,?,'merma_wa',?)`,
          [p.id, bodegaId, params.id_lote || null, -Math.abs(params.cantidad), user.id]
        );
        if (params.id_lote) {
          await db.execute(
            `UPDATE stock SET cantidad = GREATEST(0, cantidad - ?) WHERE producto_id=? AND lote=?`,
            [Math.abs(params.cantidad), p.id, params.id_lote]
          );
        }
        const msg = `⚠️ *Merma registrada*\nProducto: ${params.id_item}\nCantidad: ${params.cantidad}\nMotivo: ${params.motivo || 'No especificado'}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'SOLICITAR_CIERRE_PRODUCCION': {
        const [rows] = await db.execute(`SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1`, [params.id_orden]);
        if (!rows.length) throw { status: 404, message: `Orden #${params.id_orden} no encontrada` };
        const cantReal = params.cantidad_real || rows[0].cantidad_obj;
        await db.execute(
          `UPDATE ordenes_produccion SET estado='completada', cantidad_prod=?, updated_at=NOW() WHERE id=?`,
          [cantReal, params.id_orden]
        );
        const loteOP = `L-OP${params.id_orden}-${Date.now()}`;
        await upsertStock(db, { producto_id: rows[0].producto_id, bodega_id: bodegaId, lote: loteOP, cantidad: cantReal });
        await db.execute(
          `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
           VALUES ('entrada',?,?,?,?,?,'orden_produccion',?)`,
          [rows[0].producto_id, bodegaId, loteOP, cantReal, params.id_orden, user.id]
        );
        const msg = `✅ *Orden #${params.id_orden} cerrada*\nCantidad producida: ${cantReal}\nLote generado: ${loteOP}`;
        await sendBack(from, msg);
        result = { message: msg, lote: loteOP };
        break;
      }

      case 'SOLICITAR_DESPACHO': {
        const p = await findProductBySku(db, params.id_item || params.id_lote);
        const cantDesp = Number(params.cantidad) || 0;
        if (params.id_lote) {
          await db.execute(
            `UPDATE stock SET cantidad = GREATEST(0, cantidad - ?) WHERE producto_id=? AND bodega_id=? AND lote=? LIMIT 1`,
            [cantDesp, p.id, bodegaId, params.id_lote]
          );
        } else {
          await db.execute(
            `UPDATE stock SET cantidad = GREATEST(0, cantidad - ?) WHERE producto_id=? AND bodega_id=? LIMIT 1`,
            [cantDesp, p.id, bodegaId]
          );
        }
        await db.execute(
          `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_tipo, usuario_id)
           VALUES ('salida',?,?,?,?,'despacho_wa',?)`,
          [p.id, bodegaId, params.id_lote || null, cantDesp, user.id]
        );
        const msg = `🚚 *Despacho registrado*\nProducto: ${params.id_item || params.id_lote}\nCantidad: ${cantDesp}${params.cliente_destino ? '\nCliente: '+params.cliente_destino : ''}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_STOCK_MATERIA_PRIMA':
      case 'CONSULTAR_STOCK_PRODUCTO_TERMINADO': {
        if (params.id_item) {
          const p = await findProductBySku(db, params.id_item);
          const [rows] = await db.execute(
            `SELECT COALESCE(SUM(cantidad),0) AS disp, COALESCE(SUM(reservada),0) AS res, COUNT(*) AS lotes
             FROM stock WHERE producto_id=? AND bodega_id=?`, [p.id, bodegaId]
          );
          const msg = `📊 *Stock: ${params.id_item}*\nDisponible: ${rows[0].disp} und\nReservado: ${rows[0].res} und\nLotes: ${rows[0].lotes}`;
          await sendBack(from, msg);
          result = { message: msg };
        } else {
          // productos.activo sí existe ✅
          const [rows] = await db.execute(
            `SELECT p.siigo_code, p.nombre, COALESCE(SUM(s.cantidad),0) AS stock
             FROM productos p LEFT JOIN stock s ON s.producto_id=p.id AND s.bodega_id=?
             WHERE p.activo=1 GROUP BY p.id ORDER BY stock DESC LIMIT 10`, [bodegaId]
          );
          const lines = rows.map(r => `  • ${r.siigo_code}: ${r.stock} und`).join('\n');
          const msg = `📦 *Stock top 10:*\n${lines || '  (Sin stock registrado)'}`;
          await sendBack(from, msg);
          result = { message: msg };
        }
        break;
      }

      case 'CONSULTAR_ESTADO_PRODUCCION': {
        const [rows] = await db.execute(
          `SELECT o.*, p.nombre AS producto, p.siigo_code
           FROM ordenes_produccion o JOIN productos p ON p.id=o.producto_id
           WHERE o.id = ? LIMIT 1`, [params.id_orden]
        );
        if (!rows.length) throw { status: 404, message: `Orden #${params.id_orden} no encontrada` };
        const o = rows[0];
        const msg = `🔍 *Orden #${params.id_orden}*\nProducto: ${o.producto} (${o.siigo_code})\nEstado: ${o.estado}\nPlanificado: ${o.cantidad_obj}\nProducido: ${o.cantidad_prod || 0}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_TRAZABILIDAD_LOTE': {
        const [rows] = await db.execute(
          `SELECT s.*, p.nombre, p.siigo_code FROM stock s
           JOIN productos p ON p.id=s.producto_id
           WHERE s.lote = ? LIMIT 1`, [params.id_lote]
        );
        if (!rows.length) throw { status: 404, message: `Lote "${params.id_lote}" no encontrado` };
        const s = rows[0];
        const msg = `🔎 *Lote: ${params.id_lote}*\nProducto: ${s.nombre} (${s.siigo_code})\nCantidad: ${s.cantidad} und\nReservado: ${s.reservada} und\nVence: ${s.fecha_venc || 'N/A'}`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'CONSULTAR_CAPACIDAD_FABRICACION': {
        const p = await findProductBySku(db, params.id_producto_final);
        const [bom] = await db.execute(
          `SELECT b.*, pr.siigo_code, pr.id AS insumo_id FROM bom b
           JOIN productos pr ON pr.id=b.insumo_producto_id WHERE b.producto_id=?`, [p.id]
        ).catch(() => [[]]);
        let canProduce = true;
        const checks = [];
        for (const item of bom) {
          const needed = parseFloat(item.cantidad_por_unidad) * params.cantidad_deseada;
          const [st] = await db.execute(
            `SELECT COALESCE(SUM(cantidad),0) AS stock FROM stock WHERE producto_id=? AND bodega_id=?`,
            [item.insumo_id, bodegaId]
          );
          const ok = parseFloat(st[0].stock) >= needed;
          if (!ok) canProduce = false;
          checks.push(`  ${ok?'✅':'❌'} ${item.siigo_code}: necesita ${needed}, tiene ${st[0].stock}`);
        }
        const msg = `${canProduce?'✅':'❌'} *Capacidad para ${params.cantidad_deseada} uds de ${params.id_producto_final}:*\n${checks.join('\n') || '  (Sin BOM configurado)'}`;
        await sendBack(from, msg);
        result = { message: msg, can_produce: canProduce };
        break;
      }

      case 'CONFIRMAR_MATERIALES_PRODUCCION':
      case 'EXCEPCION_PICKING': {
        await db.execute(
          `UPDATE ordenes_produccion SET estado='en_proceso', updated_at=NOW() WHERE id=?`,
          [params.id_orden]
        );
        const msg = `✅ *Materiales confirmados*\nOrden #${params.id_orden} → En proceso`;
        await sendBack(from, msg);
        result = { message: msg };
        break;
      }

      case 'GESTION_DEVOLUCION': {
        const p = await findProductBySku(db, params.id_item);
        const loteDev = `L-DEV-${p.siigo_code}-${Date.now()}`;
        const numero = await nextRecepcionNumero(db);
        const [recIns] = await db.execute(
          `INSERT INTO recepciones (numero, bodega_id, proveedor_nombre, estado, usuario_id, observaciones)
           VALUES (?,?,?,'completada',?,?)`,
          [numero, bodegaId, params.cliente_origen || null, user.id, `Devolución - ${params.estado || 'CUARENTENA'}`]
        );
        await db.execute(
          `INSERT INTO recepcion_items (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
           VALUES (?,?,?,?,?)`,
          [recIns.insertId, p.id, loteDev, params.cantidad, params.cantidad]
        );
        await upsertStock(db, { producto_id: p.id, bodega_id: bodegaId, lote: loteDev, cantidad: params.cantidad });
        const msg = `🔄 *Devolución registrada*\nProducto: ${params.id_item}\nCantidad: ${params.cantidad}\nLote: ${loteDev}`;
        await sendBack(from, msg);
        result = { message: msg, lote: loteDev };
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
    await saveLog(db, { from, action, priority, payload: rawBody, response: { error: errMsg }, status: 'ERROR' }).catch(() => {});
    return res.status(err.status || 500).json({ ok: false, error: errMsg });
  } finally {
    await db.end().catch(() => {});
  }
};
