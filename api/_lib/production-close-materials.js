const crypto = require('crypto');

function closeError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normalizeCloseMaterials(value) {
  if (!Array.isArray(value)) {
    throw closeError(400, 'Indica los materiales repuestos al cierre, o confirma expresamente que no hubo ninguno');
  }
  if (value.length > 30) throw closeError(400, 'El cierre admite máximo 30 partidas de material repuesto');
  return value.map((item, index) => {
    const sku = String(item?.sku || item?.producto || '').trim();
    const quantity = Number(item?.cantidad);
    const lot = String(item?.lote || '').trim();
    const reason = String(item?.motivo || item?.causa || '').trim().replace(/\s+/gu, ' ');
    const location = String(item?.ubicacion || item?.ubicacion_id || '').trim();
    if (!sku || !lot || !reason) {
      throw closeError(400, `Material repuesto ${index + 1}: producto, lote y causa son obligatorios`);
    }
    if (sku.length > 200 || lot.length > 80 || reason.length > 255) {
      throw closeError(400, `Material repuesto ${index + 1}: un dato supera la longitud permitida`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999
      || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001) {
      throw closeError(400, `Material repuesto ${index + 1}: cantidad positiva con máximo tres decimales`);
    }
    if (/^(?:merma|perdida|pérdida|reposicion|reposición|material)$/iu.test(reason)) {
      throw closeError(400, `Material repuesto ${index + 1}: indica la causa concreta, por ejemplo ruptura o derrame`);
    }
    return { sku, quantity, lot, reason, location };
  });
}

async function consumeCloseMaterials(conn, { order, materials, lines, userId }) {
  const bySku = new Map(materials.map(material => [String(material.sku).toUpperCase(), material]));
  const seen = new Set();
  const consumed = [];
  for (const line of lines) {
    const material = bySku.get(line.sku.toUpperCase());
    if (!material) throw closeError(409, `El material ${line.sku} no pertenece a la OP ID ${order.id}`);
    const unit = String(material.unidad || '').toLowerCase();
    if (!['g', 'gr', 'gramo', 'gramos'].includes(unit) && !Number.isInteger(line.quantity)) {
      throw closeError(400, `La cantidad de ${material.sku} debe expresarse en unidades enteras`);
    }
    const key = `${material.producto_id}|${line.lot}|${line.location.toUpperCase()}`;
    if (seen.has(key)) throw closeError(409, `El material ${material.sku} y lote ${line.lot} aparecen dos veces; indica el total en una sola partida`);
    seen.add(key);
    const [lots] = await conn.execute(
      `SELECT id, qty_current, status, bodega_id FROM lots
        WHERE BINARY lpn = BINARY ? AND product_id = ? LIMIT 1 FOR UPDATE`,
      [line.lot, material.producto_id]
    );
    if (!lots.length || lots[0].status !== 'DISPONIBLE') {
      throw closeError(409, `El lote ${line.lot} de ${material.sku} no está disponible`);
    }
    const [stocks] = await conn.execute(
      `SELECT s.id, s.bodega_id, s.ubicacion_id, s.cantidad, s.reservada,
              u.codigo AS ubicacion
         FROM stock s JOIN ubicaciones u ON u.id = s.ubicacion_id
        WHERE s.producto_id = ? AND BINARY s.lote = BINARY ?
          AND s.bodega_id = ? AND u.activa = 1
          AND (s.cantidad - s.reservada) > 0
        ORDER BY u.codigo, s.id FOR UPDATE`,
      [material.producto_id, line.lot, lots[0].bodega_id]
    );
    const candidates = line.location
      ? stocks.filter(stock => String(stock.ubicacion_id) === line.location
        || stock.ubicacion.toUpperCase() === line.location.toUpperCase())
      : stocks;
    if (!candidates.length) throw closeError(409, `No hay stock disponible de ${material.sku}, lote ${line.lot}${line.location ? `, ubicación ${line.location}` : ''}`);
    if (candidates.length > 1) {
      throw closeError(409, `El lote ${line.lot} está en varias ubicaciones: ${candidates.map(stock => stock.ubicacion).join(', ')}. Indica de cuál se tomó`);
    }
    const stock = candidates[0];
    if (Number(stock.cantidad) - Number(stock.reservada) + 0.000001 < line.quantity
      || Number(lots[0].qty_current) + 0.000001 < line.quantity) {
      throw closeError(409, `Stock insuficiente para ${material.sku}, lote ${line.lot}, ubicación ${stock.ubicacion}`);
    }
    const [stockUpdate] = await conn.execute(
      `UPDATE stock SET cantidad = cantidad - ?, actualizado_en = NOW()
        WHERE id = ? AND cantidad - reservada >= ?`,
      [line.quantity, stock.id, line.quantity]
    );
    if (stockUpdate.affectedRows !== 1) throw closeError(409, `El saldo de ${line.lot} cambió; revisa el cierre antes de repetirlo`);
    const [lotUpdate] = await conn.execute(
      `UPDATE lots SET qty_current = qty_current - ?, updated_at = NOW()
        WHERE id = ? AND qty_current >= ?`,
      [line.quantity, lots[0].id, line.quantity]
    );
    if (lotUpdate.affectedRows !== 1) throw closeError(409, `El saldo del lote ${line.lot} cambió; revisa el cierre`);
    await conn.execute(
      `UPDATE lots SET status = IF(qty_current <= 0, 'AGOTADO', 'DISPONIBLE') WHERE id = ?`,
      [lots[0].id]
    );
    await conn.execute(
      `INSERT INTO produccion_material_lotes
        (produccion_material_id, stock_id, lote, ubicacion_id, cantidad_reservada,
         cantidad_alistada, cantidad_consumida, es_adicional, confirmado_por, confirmado_en, creado_en)
       VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, NOW(), NOW())`,
      [material.id, stock.id, line.lot, stock.ubicacion_id, line.quantity, line.quantity, userId]
    );
    await conn.execute(
      `UPDATE produccion_materiales SET cantidad_alistada = cantidad_alistada + ?,
          cantidad_consumida = cantidad_consumida + ?, cantidad_adicional = cantidad_adicional + ?,
          actualizado_en = NOW() WHERE id = ?`,
      [line.quantity, line.quantity, line.quantity, material.id]
    );
    await conn.execute(
      `INSERT INTO movimientos
        (tipo, producto_id, bodega_orig, ubicacion_orig, lote, cantidad,
         referencia_id, referencia_tipo, usuario_id, siigo_sync)
       VALUES ('salida', ?, ?, ?, ?, ?, ?, 'cierre_produccion_material', ?, 0)`,
      [material.producto_id, stock.bodega_id, stock.ubicacion_id, line.lot,
        line.quantity, order.id, userId]
    );
    const [balances] = await conn.execute('SELECT qty_current FROM lots WHERE id = ? LIMIT 1', [lots[0].id]);
    await conn.execute(
      `INSERT INTO kardex
        (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
         reference, notes, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'CONSUMO_MATERIAL', ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), crypto.randomUUID(), lots[0].id, material.producto_id,
        userId, -line.quantity, Number(balances[0]?.qty_current || 0),
        `produccion:${order.codigo_orden}`,
        `Material repuesto al cierre | ${line.reason} | Lote ${line.lot} | Ubicación ${stock.ubicacion}`, userId]
    );
    const wasteNumber = `MER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await conn.execute(
      `INSERT INTO mermas
        (numero, tipo, producto_id, lote, orden_produccion_id, ubicacion_id, cantidad,
         motivo, usuario_id, aprobado_por, estado, creado_en)
       VALUES (?, 'PROCESO', ?, ?, ?, ?, ?, ?, ?, ?, 'APROBADO', NOW())`,
      [wasteNumber, material.producto_id, line.lot, order.id, stock.ubicacion_id,
        line.quantity, line.reason, userId, userId]
    );
    consumed.push({ sku: material.sku, producto: material.nombre, unidad: material.unidad,
      cantidad: line.quantity, lote: line.lot, ubicacion: stock.ubicacion,
      motivo: line.reason, numero_merma: wasteNumber });
  }
  return consumed;
}

module.exports = { consumeCloseMaterials, normalizeCloseMaterials };
