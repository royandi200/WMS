// POST /api/v1/approvals/approve
const crypto = require('crypto');
const https = require('https');
const { createConnection, query } = require('../../_lib/db');
const { cors, requireRole } = require('../../_lib/auth');

const BB_TOKEN = process.env.BUILDERBOT_API_TOKEN || '';
const BB_BOT_ID = process.env.BUILDERBOT_BOT_ID || '';

function httpError(status, message, data = undefined) {
  const err = new Error(message);
  err.status = status;
  err.data = data;
  return err;
}

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function fmtNumber(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function fmtDate(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(value);
  }
}

async function pushWA(phone, text) {
  return new Promise((resolve) => {
    try {
      const number = String(phone || '').replace(/[^\d]/g, '');
      if (!number || !BB_TOKEN || !BB_BOT_ID) return resolve(null);

      const body = JSON.stringify({ number, messages: { content: text } });
      const req = https.request({
        hostname: 'app.builderbot.cloud',
        path: `/api/v2/${BB_BOT_ID}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-builderbot': BB_TOKEN,
          'Content-Length': Buffer.byteLength(body),
        },
      }, (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: raw.slice(0, 400) }));
      });

      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    } catch (_) {
      resolve(null);
    }
  });
}

async function getDefaultBodega(conn, payload) {
  if (payload?.bodega_id) return Number(payload.bodega_id);
  const [rows] = await conn.execute(`SELECT id FROM bodegas WHERE activa = 1 ORDER BY id ASC LIMIT 1`);
  if (!rows.length) throw httpError(500, 'No hay bodega activa configurada');
  return rows[0].id;
}

async function findProductId(conn, value) {
  const term = String(value || '').trim();
  if (!term) return null;
  if (Number.isFinite(Number(term)) && Number(term) > 0) return Number(term);

  const [rows] = await conn.execute(
    `SELECT p.id
     FROM productos p
     LEFT JOIN skus s ON s.producto_id = p.id
     WHERE (p.siigo_code = ? OR s.sku = ?)
       AND p.activo = 1
     LIMIT 1`,
    [term, term]
  );
  return rows[0]?.id || null;
}

async function lotIdByLpn(conn, lpn) {
  if (!lpn) return null;
  const [rows] = await conn.execute(`SELECT id FROM lots WHERE lpn = ? LIMIT 1`, [lpn]);
  return rows[0]?.id || null;
}

async function getStockBalance(conn, productId, bodegaId) {
  const [rows] = await conn.execute(
    `SELECT COALESCE(SUM(cantidad), 0) AS total FROM stock WHERE producto_id = ? AND bodega_id = ?`,
    [productId, bodegaId]
  );
  return Number(rows[0]?.total || 0);
}

async function logKardex(conn, { productId, userId, action, qty, lotId, balanceAfter, reference, notes }) {
  await conn.execute(
    `INSERT INTO kardex
       (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after, reference, notes, approved_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      crypto.randomUUID(),
      crypto.randomUUID(),
      lotId || null,
      productId,
      userId,
      action,
      qty,
      balanceAfter ?? null,
      reference || null,
      notes || null,
      userId,
    ]
  );
}

async function logSystemEvent(conn, { modulo, nivel = 'INFO', mensaje, usuarioId, payload }) {
  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [modulo, nivel, mensaje, usuarioId || null, payload ? JSON.stringify(payload) : null]
  ).catch(() => {});
}

async function createLot(conn, { lpn, productId, bodegaId, qty, userId, notes }) {
  const id = crypto.randomUUID();
  await conn.execute(
    `INSERT INTO lots
       (id, lpn, product_id, bodega_id, qty_initial, qty_current, origin, status, received_by, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PRODUCCION', 'DISPONIBLE', ?, ?, NOW())`,
    [id, lpn, productId, bodegaId, qty, qty, userId, notes || null]
  );
  return id;
}

async function upsertStock(conn, { productId, bodegaId, lpn, qty }) {
  const [existing] = await conn.execute(
    `SELECT id FROM stock WHERE producto_id = ? AND bodega_id = ? AND lote = ? LIMIT 1`,
    [productId, bodegaId, lpn]
  );
  if (existing.length) {
    await conn.execute(`UPDATE stock SET cantidad = cantidad + ?, actualizado_en = NOW() WHERE id = ?`, [qty, existing[0].id]);
    return;
  }
  await conn.execute(
    `INSERT INTO stock (producto_id, bodega_id, lote, cantidad, reservada, actualizado_en)
     VALUES (?, ?, ?, ?, 0, NOW())`,
    [productId, bodegaId, lpn, qty]
  );
}

async function resolveDispatchAllocations(conn, { productId, bodegaId, qty, lpn }) {
  const requested = Number(qty);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw httpError(400, 'La cantidad de despacho debe ser positiva');
  }

  if (lpn) {
    const [rows] = await conn.execute(
      `SELECT s.lote AS lpn, (s.cantidad - COALESCE(s.reservada, 0)) AS disponible
       FROM stock s
       LEFT JOIN lots l ON BINARY l.lpn = BINARY s.lote
       WHERE s.producto_id = ? AND s.bodega_id = ? AND s.lote = ?
         AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
       LIMIT 1`,
      [productId, bodegaId, lpn]
    );
    const disponible = Number(rows[0]?.disponible || 0);
    if (disponible < requested) {
      throw httpError(409, `Stock insuficiente en lote ${lpn}. Disponible: ${fmtNumber(disponible)} und`);
    }
    return [{ lpn, qty: requested, disponibleAntes: disponible }];
  }

  const [rows] = await conn.execute(
    `SELECT s.lote AS lpn,
            (s.cantidad - COALESCE(s.reservada, 0)) AS disponible,
            COALESCE(l.expiry_date, s.fecha_venc) AS vence
     FROM stock s
     LEFT JOIN lots l ON BINARY l.lpn = BINARY s.lote
     WHERE s.producto_id = ? AND s.bodega_id = ?
       AND s.lote IS NOT NULL
       AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
       AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
     ORDER BY CASE WHEN COALESCE(l.expiry_date, s.fecha_venc) IS NULL THEN 1 ELSE 0 END,
              COALESCE(l.expiry_date, s.fecha_venc) ASC,
              s.id ASC`,
    [productId, bodegaId]
  );

  let remaining = requested;
  const allocations = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const disponible = Number(row.disponible || 0);
    const take = Math.min(disponible, remaining);
    if (take > 0) {
      allocations.push({ lpn: row.lpn, qty: take, disponibleAntes: disponible, vence: row.vence || null });
      remaining -= take;
    }
  }

  if (remaining > 0) {
    const total = requested - remaining;
    throw httpError(409, total > 0
      ? `Stock insuficiente para despacho. Disponible FIFO trazable: ${fmtNumber(total)} und`
      : 'No hay lote disponible para despacho FIFO. El producto puede estar sin stock o con stock sin lote trazable.');
  }
  return allocations;
}

async function insertDispatch(conn, { numero, customer, bodegaId, productId, allocations, userId, notes }) {
  const totalQty = allocations.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  let dispatchId = null;

  try {
    const [inserted] = await conn.execute(
      `INSERT INTO despachos
         (numero, cliente_nombre, bodega_id, producto_id, lote, cantidad, estado, usuario_id, observaciones, creado_en, despachado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'despachado', ?, ?, NOW(), NOW())`,
      [
        numero,
        customer || null,
        bodegaId,
        productId,
        allocations.length === 1 ? allocations[0].lpn : 'MULTILOTE',
        totalQty,
        userId,
        notes || null,
      ]
    );
    dispatchId = inserted.insertId;
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR' && err.code !== 'ER_UNKNOWN_COLUMN') throw err;
    const [inserted] = await conn.execute(
      `INSERT INTO despachos
         (numero, cliente_nombre, bodega_id, estado, usuario_id, observaciones, creado_en, despachado_en)
       VALUES (?, ?, ?, 'despachado', ?, ?, NOW(), NOW())`,
      [numero, customer || null, bodegaId, userId, notes || null]
    );
    dispatchId = inserted.insertId;
  }

  for (const item of allocations) {
    await conn.execute(
      `INSERT INTO despacho_items (despacho_id, producto_id, lote, cantidad_sol, cantidad_des)
       VALUES (?, ?, ?, ?, ?)`,
      [dispatchId, productId, item.lpn || null, item.qty, item.qty]
    ).catch(() => {});
  }

  return dispatchId;
}

async function executeApprovedPayload(conn, { accion, payload, userId }) {
  const bodegaId = await getDefaultBodega(conn, payload);

  if (accion === 'SOLICITAR_INICIO_PRODUCCION') {
    const [orders] = await conn.execute(`SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1 FOR UPDATE`, [payload.order_id]);
    if (!orders.length) throw httpError(404, `Orden #${payload.order_id} no encontrada`);
    const order = orders[0];
    if (!['PLANEADA', 'APROBADA'].includes(order.estado)) {
      throw httpError(409, `La orden ${order.codigo_orden} esta en estado ${order.estado}`);
    }

    const [bom] = await conn.execute(
      `SELECT b.insumo_id, b.cantidad_por_unidad, b.unidad, p.siigo_code
       FROM bom b
       JOIN productos p ON p.id = b.insumo_id
       WHERE b.producto_final_id = ? AND b.activo = 1`,
      [order.producto_id]
    );

    const reserved = [];
    for (const item of bom) {
      const qty = Number(item.cantidad_por_unidad || 0) * Number(order.cantidad_planeada || 0);
      if (qty <= 0) continue;
      const [updated] = await conn.execute(
        `UPDATE stock
         SET reservada = COALESCE(reservada, 0) + ?, actualizado_en = NOW()
         WHERE producto_id = ? AND bodega_id = ?
           AND (cantidad - COALESCE(reservada, 0)) >= ?
         ORDER BY id ASC LIMIT 1`,
        [qty, item.insumo_id, bodegaId, qty]
      );
      if (updated.affectedRows !== 1) {
        throw httpError(409, `Stock insuficiente para reservar ${item.siigo_code}`);
      }
      reserved.push({ sku: item.siigo_code, qty, unit: item.unidad });
    }

    await conn.execute(
      `UPDATE ordenes_produccion SET estado = 'APROBADA', aprobado_por = ? WHERE id = ?`,
      [userId, order.id]
    );

    return { tipo: 'produccion_inicio', orden: order.codigo_orden, estado: 'APROBADA', reservados: reserved };
  }

  if (accion === 'SOLICITAR_CIERRE_PRODUCCION') {
    const [orders] = await conn.execute(`SELECT * FROM ordenes_produccion WHERE id = ? LIMIT 1 FOR UPDATE`, [payload.order_id]);
    if (!orders.length) throw httpError(404, `Orden #${payload.order_id} no encontrada`);
    const order = orders[0];
    if (order.estado !== 'EN_PROCESO') {
      throw httpError(409, `La orden ${order.codigo_orden} esta en estado ${order.estado} y debe estar EN_PROCESO`);
    }

    const qtyReal = Number(payload.qty_real ?? payload.cantidad_real);
    const qtyWaste = Number(payload.qty_waste ?? payload.merma ?? 0);
    if (!Number.isFinite(qtyReal) || qtyReal < 0) {
      throw httpError(400, 'El cierre requiere cantidad real producida');
    }
    if (!Number.isFinite(qtyWaste) || qtyWaste < 0) {
      throw httpError(400, 'La merma de cierre no puede ser negativa');
    }
    if (qtyWaste > 0 && !payload.motivo_merma && !payload.motivo) {
      throw httpError(400, 'El cierre con merma requiere motivo');
    }

    const [prodRows] = await conn.execute(`SELECT siigo_code FROM productos WHERE id = ? LIMIT 1`, [order.producto_id]);
    const sku = prodRows[0]?.siigo_code || `PT-${order.producto_id}`;
    const lpn = `L-${sku}-${order.codigo_orden}-${Date.now()}`;
    const lotId = await createLot(conn, {
      lpn,
      productId: order.producto_id,
      bodegaId,
      qty: qtyReal,
      userId,
      notes: `Orden de produccion ${order.codigo_orden}`,
    });
    await upsertStock(conn, { productId: order.producto_id, bodegaId, lpn, qty: qtyReal });

    await conn.execute(
      `UPDATE ordenes_produccion
       SET estado = 'CERRADA', cantidad_real = ?, aprobado_por = ?, cerrado_en = NOW()
       WHERE id = ?`,
      [qtyReal, userId, order.id]
    );

    await conn.execute(
      `INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
       VALUES ('entrada', ?, ?, ?, ?, ?, 'orden_produccion', ?)`,
      [order.producto_id, bodegaId, lpn, qtyReal, order.id, userId]
    );

    const balance = await getStockBalance(conn, order.producto_id, bodegaId);
    await logKardex(conn, {
      productId: order.producto_id,
      userId,
      action: 'CIERRE_PRODUCCION',
      qty: qtyReal,
      lotId,
      balanceAfter: balance,
      reference: `orden_produccion:${order.id}`,
      notes: qtyWaste > 0 ? `Merma cierre: ${fmtNumber(qtyWaste)} | Motivo: ${payload.motivo_merma || payload.motivo}` : 'Cierre sin merma',
    });

    return {
      tipo: 'produccion_cierre',
      orden: order.codigo_orden,
      lote: lpn,
      cantidad_real: qtyReal,
      merma: qtyWaste,
      motivo_merma: payload.motivo_merma || payload.motivo || null,
    };
  }

  if (accion === 'SOLICITAR_DESPACHO') {
    const productId = await findProductId(conn, payload.product_id || payload.id_item || payload.producto_id || payload.sku);
    const qty = Number(payload.qty || payload.cantidad);
    if (!productId) throw httpError(400, 'La solicitud de despacho no tiene producto');

    const allocations = await resolveDispatchAllocations(conn, {
      productId,
      bodegaId,
      qty,
      lpn: payload.lpn || payload.id_lote || payload.lote || null,
    });

    const numero = `DSP-${Date.now()}`;
    const dispatchId = await insertDispatch(conn, {
      numero,
      customer: payload.customer || payload.cliente_destino || null,
      bodegaId,
      productId,
      allocations,
      userId,
      notes: 'Despacho aprobado desde dashboard/API',
    });

    const lotLines = [];
    for (const item of allocations) {
      const [stockUpdate] = await conn.execute(
        `UPDATE stock
         SET cantidad = cantidad - ?, actualizado_en = NOW()
         WHERE producto_id = ? AND bodega_id = ? AND lote = ? AND cantidad >= ? LIMIT 1`,
        [item.qty, productId, bodegaId, item.lpn, item.qty]
      );
      if (stockUpdate.affectedRows !== 1) {
        throw httpError(409, `Stock insuficiente para despachar lote ${item.lpn}`);
      }

      const [lotUpdate] = await conn.execute(
        `UPDATE lots SET qty_current = qty_current - ? WHERE lpn = ? AND qty_current >= ?`,
        [item.qty, item.lpn, item.qty]
      );
      if (lotUpdate.affectedRows !== 1) {
        throw httpError(409, `Saldo insuficiente en lote ${item.lpn}`);
      }
      await conn.execute(`UPDATE lots SET status = IF(qty_current <= 0, 'DESPACHADO', 'DISPONIBLE') WHERE lpn = ?`, [item.lpn]);

      await conn.execute(
        `INSERT INTO movimientos (tipo, producto_id, bodega_orig, lote, cantidad, referencia_id, referencia_tipo, usuario_id)
         VALUES ('salida', ?, ?, ?, ?, ?, 'despacho_aprobado', ?)`,
        [productId, bodegaId, item.lpn, item.qty, dispatchId, userId]
      );

      const [lotRows] = await conn.execute(`SELECT id, qty_current FROM lots WHERE lpn = ? LIMIT 1`, [item.lpn]);
      const lotBalance = Number(lotRows[0]?.qty_current || 0);
      await logKardex(conn, {
        productId,
        userId,
        action: 'DESPACHO',
        qty: -Number(item.qty),
        lotId: lotRows[0]?.id || null,
        balanceAfter: lotBalance,
        reference: `despacho:${numero}`,
        notes: payload.customer ? `Cliente: ${payload.customer}` : null,
      });

      lotLines.push({ lpn: item.lpn, qty: item.qty, saldo_lote: lotBalance });
    }

    return {
      tipo: 'despacho',
      numero_despacho: numero,
      cliente: payload.customer || payload.cliente_destino || null,
      cantidad: qty,
      lotes: lotLines,
    };
  }

  throw httpError(422, `No hay handler de aprobacion para ${accion}`);
}

function buildApprovalMessage(accion, result, requestCode) {
  if (accion === 'SOLICITAR_INICIO_PRODUCCION') {
    return [
      `Solicitud ${requestCode} APROBADA`,
      `Orden: ${result.orden}`,
      `Materiales reservados: ${result.reservados?.length ?? 0}`,
      `Cuando tengas los insumos listos, responde: confirmo materiales orden ${result.orden}`,
    ].join('\n');
  }

  if (accion === 'SOLICITAR_CIERRE_PRODUCCION') {
    return [
      `Solicitud ${requestCode} APROBADA`,
      `Cierre de produccion aprobado.`,
      `Orden: ${result.orden}`,
      `PT ingresado: ${fmtNumber(result.cantidad_real)} und`,
      `Lote: ${result.lote}`,
      `Merma declarada: ${fmtNumber(result.merma || 0)} und`,
    ].join('\n');
  }

  if (accion === 'SOLICITAR_DESPACHO') {
    const lotes = (result.lotes || []).map(l => `- ${l.lpn}: ${fmtNumber(l.qty)} und, saldo ${fmtNumber(l.saldo_lote)} und`);
    return [
      `Solicitud ${requestCode} APROBADA`,
      `Despacho: ${result.numero_despacho}`,
      result.cliente ? `Cliente: ${result.cliente}` : '',
      `Cantidad: ${fmtNumber(result.cantidad)} und`,
      `Lotes:`,
      ...lotes,
    ].filter(Boolean).join('\n');
  }

  return `Solicitud ${requestCode} APROBADA`;
}

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let user;
  try {
    user = await requireRole(req, ['Admin', 'Validador']);
  } catch (e) {
    return res.status(e.status || 401).json({ ok: false, error: e.message });
  }

  const requestCode = req.body?.request_code || req.body?.codigo_solicitud || null;
  if (!requestCode) return res.status(400).json({ ok: false, error: 'request_code requerido' });

  let conn;
  try {
    conn = await createConnection();
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT *
       FROM aprobaciones
       WHERE codigo_solicitud = ?
       LIMIT 1 FOR UPDATE`,
      [requestCode]
    );

    if (!rows.length) throw httpError(404, 'Solicitud no encontrada');

    const solicitud = rows[0];
    const payload = parsePayload(solicitud.payload);

    if (solicitud.estado !== 'PENDIENTE') {
      const [processed] = await conn.execute(
        `SELECT a.estado, a.accion, a.procesado_en, a.motivo_rechazo,
                u.nombre AS procesado_por_nombre
         FROM aprobaciones a
         LEFT JOIN usuarios u ON u.id = a.procesado_por
         WHERE a.codigo_solicitud = ?
         LIMIT 1`,
        [requestCode]
      );
      const info = processed[0] || solicitud;
      const quien = info.procesado_por_nombre || 'otro usuario';
      const cuando = fmtDate(info.procesado_en);
      const estadoTxt = String(info.estado || '').toLowerCase();
      throw httpError(
        409,
        `${requestCode} ya fue ${estadoTxt} por ${quien}${cuando ? ` el ${cuando}` : ''}`,
        {
          codigo_solicitud: requestCode,
          estado: info.estado,
          accion: info.accion,
          procesado_por_nombre: quien,
          procesado_en: info.procesado_en,
          motivo_rechazo: info.motivo_rechazo || null,
          payload,
        }
      );
    }

    const execResult = await executeApprovedPayload(conn, {
      accion: solicitud.accion,
      payload,
      userId: user.id,
    });

    const [updated] = await conn.execute(
      `UPDATE aprobaciones
       SET estado = 'APROBADO', procesado_por = ?, procesado_en = NOW()
       WHERE codigo_solicitud = ? AND estado = 'PENDIENTE'`,
      [user.id, requestCode]
    );
    if (updated.affectedRows !== 1) {
      throw httpError(409, 'La solicitud cambio de estado durante la aprobacion');
    }

    await logSystemEvent(conn, {
      modulo: 'aprobaciones',
      mensaje: `Solicitud ${requestCode} aprobada desde dashboard/API`,
      usuarioId: user.id,
      payload: execResult,
    });

    await conn.commit();

    if (payload?.operario_phone) {
      await pushWA(payload.operario_phone, buildApprovalMessage(solicitud.accion, execResult, requestCode));
    }

    return res.status(200).json({
      ok: true,
      data: {
        codigo_solicitud: requestCode,
        estado: 'APROBADO',
        accion: solicitud.accion,
        resultado: execResult,
      },
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    if (err.status) {
      return res.status(err.status).json({ ok: false, error: err.message, data: err.data || null });
    }
    console.error('[approvals/approve]', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Error interno del servidor',
      code: err.code || null,
    });
  } finally {
    if (conn) {
      try { await conn.end(); } catch (_) {}
    }
  }
};
