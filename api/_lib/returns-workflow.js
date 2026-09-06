const crypto = require('crypto');
const { beginAdditionalConfirmation, completeAdditionalConfirmation } = require('./additional-confirmation');
const { createConnection } = require('./db');
const { workflowFlags } = require('./feature-flags');
const { resolveProductReference } = require('./product-references');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeReturnStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  const statuses = {
    recuperable: 'RECUPERABLE',
    cuarentena: 'CUARENTENA',
    destruccion: 'DESTRUCCION',
    'destruccion total': 'DESTRUCCION',
  };
  return statuses[raw] || null;
}

function normalizeReturnInput(input = {}, { allowGeneratedReference = true } = {}) {
  const quantity = Number(input.cantidad ?? input.qty);
  const status = normalizeReturnStatus(input.estado ?? input.status);
  const normalized = {
    dispatchReference: String(
      input.despacho_id ?? input.dispatch_id ?? input.id_despacho
      ?? input.id_factura ?? input.siigo_invoice_id ?? input.invoice_id ?? ''
    ).trim(),
    externalReference: String(
      input.referencia_devolucion ?? input.referencia_externa ?? input.reference ?? input.referencia ?? ''
    ).trim(),
    sku: String(input.sku ?? input.id_item ?? input.product_id ?? '').trim(),
    sourceLot: String(input.lote_origen ?? input.lote_original ?? input.source_lot ?? '').trim(),
    customer: String(input.cliente_origen ?? input.customer ?? input.cliente ?? '').trim(),
    destinationLocation: String(input.ubicacion ?? input.ubicacion_destino ?? input.location ?? '').trim(),
    notes: String(input.observaciones ?? input.notes ?? input.motivo ?? '').trim(),
    confirmNew: input.confirmar_nueva_devolucion === true || input.confirm_new_return === true,
    quantity,
    status,
  };

  if (!normalized.dispatchReference) throw httpError(400, 'Factura o despacho origen es obligatorio');
  if (!normalized.externalReference && !allowGeneratedReference) {
    throw httpError(400, 'Referencia de devolucion es obligatoria');
  }
  if (!normalized.sku) throw httpError(400, 'Producto devuelto es obligatorio');
  if (!normalized.sourceLot) throw httpError(400, 'Lote original despachado es obligatorio');
  if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, 'Cantidad de devolucion invalida');
  if (quantity > 999999999) throw httpError(400, 'Cantidad de devolucion fuera de rango');
  if (!status) throw httpError(400, 'Estado de devolucion invalido');
  for (const [label, value, max] of [
    ['Factura o despacho', normalized.dispatchReference, 80],
    ['Referencia de devolucion', normalized.externalReference, 80],
    ['Producto', normalized.sku, 80],
    ['Lote original', normalized.sourceLot, 80],
    ['Cliente', normalized.customer, 200],
    ['Ubicacion', normalized.destinationLocation, 30],
  ]) {
    if (value.length > max) throw httpError(400, `${label} supera ${max} caracteres`);
  }
  if (status === 'RECUPERABLE' && !normalized.destinationLocation) {
    throw httpError(400, 'Ubicacion destino es obligatoria para una devolucion recuperable');
  }
  return normalized;
}

function bogotaDateStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function generateReturnReference(date = new Date()) {
  return `AUTO-DEV-${bogotaDateStamp(date)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function lotStatusForReturn(status) {
  if (status === 'RECUPERABLE') return 'DISPONIBLE';
  if (status === 'CUARENTENA') return 'CUARENTENA';
  return 'PENDIENTE_DISPOSICION';
}

function parseCustomerReturnReferences(text) {
  const source = String(text || '');
  const invoice = source.match(/\b(FV-[A-Z0-9-]+)\b/i)?.[1];
  const dispatch = source.match(/\b(DSP-[A-Z0-9-]+)\b/i)?.[1];
  const sourceLot = source.match(/\blote(?:\s+original)?\s+([A-Z0-9._-]+)/i)?.[1];
  const reference = source.match(/\breferencia(?:\s+de\s+devolucion)?\s+([A-Z0-9._-]+)/i)?.[1];
  const reason = source.match(/\b(?:por|motivo)\s+([^.;\n]{3,180})/i)?.[1]?.trim();
  return {
    ...(dispatch ? { id_despacho: dispatch } : invoice ? { id_factura: invoice } : {}),
    ...(sourceLot ? { lote_origen: sourceLot } : {}),
    ...(reference ? { referencia_devolucion: reference } : {}),
    ...(reason ? { motivo: reason } : {}),
  };
}

async function findLocation(conn, warehouseId, status, requestedCode) {
  const code = status === 'RECUPERABLE' ? requestedCode : 'CUAR-C-1-01';
  const [rows] = await conn.execute(
    `SELECT id, codigo FROM ubicaciones
     WHERE bodega_id = ? AND codigo = ? AND activa = 1 LIMIT 1`,
    [warehouseId, code]
  );
  if (!rows.length) throw httpError(409, `La ubicacion ${code} no esta activa en la bodega del despacho`);
  return rows[0];
}

async function existingReturn(conn, externalReference) {
  const [rows] = await conn.execute(
    `SELECT dv.id, dv.numero, dv.cantidad, dv.estado, dv.lote, dv.lote_origen,
            dv.referencia_externa, dv.despacho_id, dv.despacho_item_id,
            dv.producto_id, dv.ubicacion_id, dv.cliente_origen, dv.observaciones,
            d.numero AS despacho_numero, d.siigo_invoice_id, d.siigo_invoice_name,
            p.siigo_code AS sku, u.codigo AS ubicacion
     FROM devoluciones dv
     LEFT JOIN despachos d ON d.id = dv.despacho_id
     JOIN productos p ON p.id = dv.producto_id
     LEFT JOIN ubicaciones u ON u.id = dv.ubicacion_id
     WHERE dv.referencia_externa = ? LIMIT 1 FOR UPDATE`,
    [externalReference]
  );
  return rows[0] || null;
}

function assertReturnDispositionEnabled(status, flags = workflowFlags()) {
  if (status === 'DESTRUCCION' && !flags.allowReturnDisposal) {
    throw httpError(409, 'La disposicion final de devoluciones esta deshabilitada');
  }
}

function returnMatches(existing, data) {
  const dispatchMatches = [
    existing.despacho_id,
    existing.despacho_numero,
    existing.siigo_invoice_id,
    existing.siigo_invoice_name,
  ].some(value => String(value || '').toUpperCase() === data.dispatchReference.toUpperCase());
  return dispatchMatches
    && String(existing.sku || '').toUpperCase() === data.sku.toUpperCase()
    && String(existing.lote_origen || '').toUpperCase() === data.sourceLot.toUpperCase()
    && Math.abs(Number(existing.cantidad) - data.quantity) < 0.000001
    && String(existing.estado || '').toUpperCase() === data.status
    && (!data.destinationLocation
      || String(existing.ubicacion || '').toUpperCase() === data.destinationLocation.toUpperCase())
    && (!data.customer
      || String(existing.cliente_origen || '').localeCompare(data.customer, 'es', { sensitivity: 'base' }) === 0)
    && (!data.notes || String(existing.observaciones || '') === data.notes);
}

async function findRecentGeneratedReturn(conn, { data, userId, dispatchId, dispatchItemId, productId, locationId }) {
  const [rows] = await conn.execute(
    `SELECT dv.id, dv.numero, dv.cantidad, dv.estado, dv.lote, dv.lote_origen,
            dv.referencia_externa, dv.observaciones, d.numero AS despacho_numero,
            d.siigo_invoice_id, d.siigo_invoice_name, p.siigo_code AS sku,
            u.codigo AS ubicacion, dv.cliente_origen
       FROM devoluciones dv
       JOIN despachos d ON d.id = dv.despacho_id
       JOIN productos p ON p.id = dv.producto_id
       LEFT JOIN ubicaciones u ON u.id = dv.ubicacion_id
      WHERE dv.referencia_externa LIKE 'AUTO-DEV-%'
        AND dv.usuario_id = ? AND dv.despacho_id = ? AND dv.despacho_item_id = ?
        AND dv.producto_id = ? AND dv.ubicacion_id <=> ?
        AND dv.lote_origen = ? AND dv.estado = ?
        AND ABS(dv.cantidad - ?) < 0.000001
        AND COALESCE(dv.observaciones, '') = ?
        AND dv.creado_en >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY dv.creado_en DESC, dv.id DESC LIMIT 1 FOR UPDATE`,
    [userId, dispatchId, dispatchItemId, productId, locationId, data.sourceLot,
     data.status, data.quantity, data.notes]
  );
  return rows[0] || null;
}

async function createCustomerReturn(input, userId) {
  const data = normalizeReturnInput(input, { allowGeneratedReference: true });
  assertReturnDispositionEnabled(data.status);
  const generatedReference = !data.externalReference;
  const conn = await createConnection();
  let dedupeLock = null;
  try {
    await conn.beginTransaction();
    const confirmation = data.confirmNew ? await beginAdditionalConfirmation(conn, {
      kind: 'DEVOLUCION', userId, base: input.id_devolucion_existente,
      payload: data,
    }) : null;
    if (confirmation?.result) {
      await conn.commit();
      return { ...confirmation.result, already_completed: true, requires_confirmation: false };
    }

    const existing = await existingReturn(conn, data.externalReference);
    if (existing) {
      if (!returnMatches(existing, data)) {
        throw httpError(409, 'La referencia de devolucion ya fue utilizada con datos diferentes');
      }
      const result = { ...existing, already_completed: true };
      await completeAdditionalConfirmation(conn, confirmation, result);
      await conn.commit();
      return result;
    }

    const numericDispatchId = /^\d+$/.test(data.dispatchReference)
      ? Number(data.dispatchReference)
      : 0;
    const [dispatchRows] = await conn.execute(
      `SELECT id, numero, estado, bodega_id, cliente_nombre, tercero_id,
              siigo_invoice_id, siigo_invoice_name
       FROM despachos
       WHERE id = ? OR numero = ? OR siigo_invoice_id = ? OR siigo_invoice_name = ?
       LIMIT 2 FOR UPDATE`,
      [numericDispatchId, data.dispatchReference, data.dispatchReference, data.dispatchReference]
    );
    if (!dispatchRows.length) throw httpError(404, 'Despacho o factura origen no encontrado');
    if (dispatchRows.length > 1) throw httpError(409, 'La referencia identifica mas de un despacho');
    const dispatch = dispatchRows[0];
    if (dispatch.estado !== 'despachado') {
      throw httpError(409, `El despacho esta en estado ${dispatch.estado} y aun no admite devoluciones`);
    }
    if (data.customer && data.customer.localeCompare(dispatch.cliente_nombre || '', 'es', { sensitivity: 'base' }) !== 0) {
      throw httpError(409, `El cliente del despacho es ${dispatch.cliente_nombre}`);
    }

    const [dispatchProducts] = await conn.execute(
      `SELECT DISTINCT producto_id FROM despacho_items
        WHERE despacho_id = ? AND lote = ?`,
      [dispatch.id, data.sourceLot]
    );
    if (!dispatchProducts.length) throw httpError(409, 'El lote no pertenece al despacho indicado');
    const product = await resolveProductReference(conn, data.sku, {
      productIds: dispatchProducts.map(item => item.producto_id),
    });

    const [items] = await conn.execute(
      `SELECT di.id, di.lote, di.cantidad_des, l.expiry_date
       FROM despacho_items di
       LEFT JOIN lots l ON l.lpn = di.lote
       WHERE di.despacho_id = ? AND di.producto_id = ? AND di.lote = ?
       LIMIT 2 FOR UPDATE`,
      [dispatch.id, product.id, data.sourceLot]
    );
    if (!items.length) throw httpError(409, 'El producto y lote no pertenecen al despacho indicado');
    if (items.length > 1) throw httpError(409, 'El lote aparece en mas de una partida del despacho');
    const item = items[0];

    const location = await findLocation(
      conn, dispatch.bodega_id, data.status, data.destinationLocation
    );

    if (!data.externalReference) {
      const canonical = JSON.stringify({
        userId: Number(userId), dispatchId: Number(dispatch.id), dispatchItemId: Number(item.id),
        productId: Number(product.id), locationId: Number(location.id), sourceLot: data.sourceLot,
        status: data.status, quantity: data.quantity, notes: data.notes,
      });
      dedupeLock = `wms_return_${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 47)}`;
      const [locks] = await conn.execute('SELECT GET_LOCK(?, 5) AS acquired', [dedupeLock]);
      if (Number(locks[0]?.acquired) !== 1) throw httpError(409, 'No fue posible confirmar la devolucion; intenta nuevamente');
      const recent = await findRecentGeneratedReturn(conn, {
        data, userId, dispatchId: dispatch.id, dispatchItemId: item.id,
        productId: product.id, locationId: location.id,
      });
      if (recent && !data.confirmNew) {
        await conn.commit();
        return { ...recent, already_completed: true, requires_confirmation: true, generated_reference: true };
      }
      data.externalReference = generateReturnReference();
    }

    const [returnedRows] = await conn.execute(
      `SELECT COALESCE(SUM(cantidad), 0) AS total
       FROM devoluciones WHERE despacho_item_id = ?`,
      [item.id]
    );
    const alreadyReturned = Number(returnedRows[0]?.total || 0);
    const remaining = Number(item.cantidad_des || 0) - alreadyReturned;
    if (data.quantity > remaining + 0.000001) {
      const unitWord = Math.abs(remaining - 1) < 0.000001 ? 'unidad retornable' : 'unidades retornables';
      throw httpError(
        409,
        `La devolucion supera lo despachado. Despachadas: ${Number(item.cantidad_des || 0)}. `
          + `Ya devueltas: ${alreadyReturned}. Puedes devolver como maximo: ${remaining} ${unitWord}.`
      );
    }

    const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
    const returnNumber = `DEV-${suffix}`;
    const receptionNumber = `REC-DEV-${suffix}`;
    const returnLot = `L-DEV-${product.siigo_code}-${suffix}`;
    const lotId = crypto.randomUUID();
    const notes = [
      `Factura: ${dispatch.siigo_invoice_name || dispatch.siigo_invoice_id}`,
      `Despacho: ${dispatch.numero}`,
      `Cliente: ${dispatch.cliente_nombre}`,
      `Lote origen: ${item.lote}`,
      `Estado: ${data.status}`,
      data.notes || null,
    ].filter(Boolean).join(' | ');

    const [reception] = await conn.execute(
      `INSERT INTO recepciones
         (numero, tercero_id, proveedor_nombre, bodega_id, estado, usuario_id,
          observaciones, creado_en, completado_en)
       VALUES (?, ?, ?, ?, 'completada', ?, ?, NOW(), NOW())`,
      [receptionNumber, dispatch.tercero_id, dispatch.cliente_nombre,
       dispatch.bodega_id, userId, `Devolucion de cliente | ${notes}`]
    );
    await conn.execute(
      `INSERT INTO recepcion_items
         (recepcion_id, producto_id, lote, cantidad_esp, cantidad_rec)
       VALUES (?, ?, ?, ?, ?)`,
      [reception.insertId, product.id, returnLot, data.quantity, data.quantity]
    );
    await conn.execute(
      `INSERT INTO lots
         (id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier,
          origin, status, received_by, notes, expiry_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'DEVOLUCION', ?, ?, ?, ?, NOW())`,
      [lotId, returnLot, product.id, dispatch.bodega_id, data.quantity, data.quantity,
       dispatch.cliente_nombre, lotStatusForReturn(data.status), userId, notes,
       item.expiry_date || null]
    );

    if (data.status === 'RECUPERABLE') {
      await conn.execute(
        `INSERT INTO stock
           (producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
        [product.id, dispatch.bodega_id, location.id, returnLot,
         item.expiry_date || null, data.quantity]
      );
      await conn.execute(
        `INSERT INTO movimientos
           (tipo, producto_id, bodega_dest, ubicacion_dest, lote, cantidad,
            referencia_id, referencia_tipo, usuario_id)
         VALUES ('entrada', ?, ?, ?, ?, ?, ?, 'devolucion_cliente', ?)`,
        [product.id, dispatch.bodega_id, location.id, returnLot, data.quantity,
         reception.insertId, userId]
      );
    }

    const [inserted] = await conn.execute(
      `INSERT INTO devoluciones
         (numero, despacho_id, despacho_item_id, producto_id, lote, lote_origen,
          ubicacion_id, referencia_externa, cliente_origen, cantidad, estado,
          recepcion_id, usuario_id, observaciones, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [returnNumber, dispatch.id, item.id, product.id, returnLot, item.lote,
       location.id, data.externalReference, dispatch.cliente_nombre, data.quantity,
       data.status, reception.insertId, userId, data.notes || null]
    );

    const [balances] = await conn.execute(
      `SELECT COALESCE(SUM(cantidad - reservada), 0) AS balance
       FROM stock WHERE producto_id = ?`,
      [product.id]
    );
    await conn.execute(
      `INSERT INTO kardex
         (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
          reference, notes, approved_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'DEVOLUCION', ?, ?, ?, ?, ?, NOW())`,
      [crypto.randomUUID(), crypto.randomUUID(), lotId, product.id, userId,
       data.quantity, data.quantity, `devolucion:${returnNumber}`, notes, userId]
    );

    const result = {
      id: inserted.insertId,
      numero: returnNumber,
      referencia_externa: data.externalReference,
      despacho_id: dispatch.id,
      despacho_numero: dispatch.numero,
      siigo_invoice_name: dispatch.siigo_invoice_name,
      cliente_origen: dispatch.cliente_nombre,
      sku: product.siigo_code,
      producto: product.nombre,
      lote: returnLot,
      lote_origen: item.lote,
      ubicacion: location.codigo,
      cantidad: data.quantity,
      estado: data.status,
      destino: data.status === 'RECUPERABLE'
        ? 'Stock disponible'
        : data.status === 'DESTRUCCION'
          ? 'PENDIENTE DE DISPOSICION (no disponible)'
          : 'CUARENTENA (no disponible)',
      already_completed: false,
      generated_reference: generatedReference,
    };
    await completeAdditionalConfirmation(conn, confirmation, result);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    if (dedupeLock) {
      await conn.execute('SELECT RELEASE_LOCK(?) AS released', [dedupeLock]).catch(() => {});
    }
    await conn.end().catch(() => {});
  }
}

module.exports = {
  createCustomerReturn,
  lotStatusForReturn,
  normalizeReturnInput,
  normalizeReturnStatus,
  parseCustomerReturnReferences,
  generateReturnReference,
  returnMatches,
  assertReturnDispositionEnabled,
};
