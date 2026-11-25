const crypto = require('crypto');

function packagingError(message, status = 409) {
  return Object.assign(new Error(message), { status });
}

function checkedPackaging(packaging) {
  if (!packaging || packaging.boxesDeclared !== true || packaging.lidsDeclared !== true
    || !Array.isArray(packaging.lines)) {
    throw packagingError('Indica por separado las cajas y las tapas de caja máster usadas antes de confirmar el despacho. No se modificó inventario.');
  }
  const totals = new Map();
  for (const line of packaging.lines) {
    const stockId = Number(line.stockId);
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(stockId) || stockId <= 0
      || !Number.isSafeInteger(quantity) || quantity <= 0) {
      throw packagingError('Una partida de embalaje tiene stock o cantidad inválida. Revisa el resumen.');
    }
    totals.set(stockId, (totals.get(stockId) || 0) + quantity);
  }
  return [...totals].map(([stockId, quantity]) => ({ stockId, quantity }));
}

async function availablePackaging(db, productId) {
  const [rows] = await db.execute(
    `SELECT s.id AS stock_id, s.producto_id, s.bodega_id, s.ubicacion_id,
            s.lote, u.codigo AS ubicacion, s.cantidad - s.reservada AS libre,
            l.qty_current AS lote_libre, DATE_FORMAT(COALESCE(l.expiry_date, s.fecha_venc), '%Y-%m-%d') AS vence
       FROM stock s
       JOIN lots l ON BINARY l.lpn = BINARY s.lote AND l.product_id = s.producto_id
       JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
       JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
      WHERE s.producto_id = ? AND l.status = 'DISPONIBLE'
        AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE())
        AND s.cantidad > s.reservada AND l.qty_current > 0
      ORDER BY COALESCE(l.expiry_date, s.fecha_venc), u.codigo, s.lote, s.id`,
    [productId]
  );
  return rows;
}

async function allocatePackaging(db, declarations) {
  const lines = [];
  for (const declaration of declarations) {
    let remaining = Number(declaration.quantity);
    if (!Number.isSafeInteger(remaining) || remaining < 0) {
      throw packagingError('Las cantidades de cajas y tapas deben ser enteras no negativas.');
    }
    if (!remaining) continue;
    const options = await availablePackaging(db, declaration.productId);
    const usedByLot = new Map();
    for (const option of options) {
      if (!remaining) break;
      const lotRemaining = Number(option.lote_libre) - (usedByLot.get(option.lote) || 0);
      const taken = Math.min(remaining, Number(option.libre), lotRemaining);
      if (taken <= 0) continue;
      lines.push({ stockId: Number(option.stock_id), productId: declaration.productId,
        sku: declaration.sku, name: declaration.name, class: declaration.class,
        quantity: taken, lot: option.lote, location: option.ubicacion,
        expires: option.vence ? String(option.vence).slice(0, 10) : null });
      usedByLot.set(option.lote, (usedByLot.get(option.lote) || 0) + taken);
      remaining -= taken;
    }
    if (remaining) throw packagingError(`No hay stock disponible suficiente de ${declaration.name} (${declaration.sku}). Faltan ${remaining} und; no se confirmó el despacho.`);
  }
  return lines;
}

async function consumeDispatchPackaging(conn, { type, referenceId, userId, packaging }) {
  const lines = checkedPackaging(packaging);
  const consumed = [];
  for (const line of lines) {
    const [rows] = await conn.execute(
      `SELECT s.id, s.producto_id, s.bodega_id, s.ubicacion_id, s.lote,
              p.siigo_code, p.nombre, c.clase
         FROM stock s
         JOIN productos p ON p.id = s.producto_id AND p.activo = 1 AND p.control_stock = 1
         JOIN despacho_embalaje_catalogo c ON c.producto_id = p.id AND c.activo = 1
         JOIN lots l ON BINARY l.lpn = BINARY s.lote AND l.product_id = s.producto_id
         JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.activa = 1
         JOIN bodegas b ON b.id = s.bodega_id AND b.activa = 1
        WHERE s.id = ? AND l.status = 'DISPONIBLE'
          AND (l.expiry_date IS NULL OR l.expiry_date >= CURRENT_DATE())
        LIMIT 1 FOR UPDATE`,
      [line.stockId]
    );
    const item = rows[0];
    if (!item) throw packagingError('Una partida de embalaje ya no está disponible. Revisa el resumen; no se descontó inventario.');
    const [stockUpdate] = await conn.execute(
      `UPDATE stock SET cantidad = cantidad - ?, actualizado_en = NOW()
        WHERE id = ? AND cantidad - reservada >= ?`,
      [line.quantity, line.stockId, line.quantity]
    );
    if (stockUpdate.affectedRows !== 1) throw packagingError(`Stock insuficiente de ${item.nombre}; no se confirmó el despacho.`);
    const [lotUpdate] = await conn.execute(
      `UPDATE lots SET qty_current = qty_current - ?, updated_at = NOW()
        WHERE lpn = ? AND product_id = ? AND status = 'DISPONIBLE' AND qty_current >= ?`,
      [line.quantity, item.lote, item.producto_id, line.quantity]
    );
    if (lotUpdate.affectedRows !== 1) throw packagingError(`Saldo insuficiente en lote ${item.lote}; no se confirmó el despacho.`);
    await conn.execute(
      `UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE')
        WHERE lpn = ? AND product_id = ?`,
      [item.lote, item.producto_id]
    );
    await conn.execute(
      `INSERT INTO despacho_embalaje_consumos
         (tipo, referencia_id, producto_id, stock_id, bodega_id, ubicacion_id, lote, cantidad, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [type, referenceId, item.producto_id, item.id, item.bodega_id,
        item.ubicacion_id, item.lote, line.quantity, userId]
    );
    await conn.execute(
      `INSERT INTO movimientos
         (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
          referencia_id, referencia_tipo, usuario_id, siigo_sync)
       VALUES ('salida', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [item.producto_id, item.bodega_id, item.ubicacion_id, item.lote,
        line.quantity, referenceId, type === 'SIIGO' ? 'despacho_embalaje' : 'maquila_embalaje_3q', userId]
    );
    const [lotRows] = await conn.execute(
      'SELECT id, qty_current FROM lots WHERE lpn = ? AND product_id = ? LIMIT 1',
      [item.lote, item.producto_id]
    );
    await conn.execute(
      `INSERT INTO kardex
         (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
          reference, notes, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'EMBALAJE_DESPACHO', ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), crypto.randomUUID(), lotRows[0]?.id || null,
        item.producto_id, userId, -line.quantity, Number(lotRows[0]?.qty_current || 0),
        `${type === 'SIIGO' ? 'despacho' : 'maquila-envio'}:${referenceId}`,
        `${item.clase}; ${item.nombre}; lote ${item.lote}`, userId]
    );
    consumed.push({ sku: item.siigo_code, nombre: item.nombre, cantidad: line.quantity,
      lote: item.lote, clase: item.clase });
  }
  return consumed;
}

module.exports = { checkedPackaging, availablePackaging, allocatePackaging, consumeDispatchPackaging };
