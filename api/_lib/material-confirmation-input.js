const { resolveProductReference } = require('./product-references');

const reject = message => Object.assign(new Error(message), { status: 409 });

async function materialConfirmationInput(db, params, text, userId) {
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/\b(?:no|cancelar|cancela|cancelado)\b/.test(normalized)
      && /\b(?:confirmo|confirma|confirmar|ajuste|movimiento)\b/.test(normalized)) {
    throw reject('No se registro otro ajuste. La confirmacion fue negada o cancelada.');
  }
  const explicit = /\bconfirm(?:o|a|ar)\b/.test(normalized)
    && /\b(?:nuevo|otro|adicional)\b/.test(normalized)
    && /\b(?:ajuste|movimiento)\b/.test(normalized);
  // "Entrega adicional" is a movement type, not consent to bypass duplicate detection.
  if (!explicit) return { ...params, confirmar_nuevo_ajuste: false, id_ajuste_existente: undefined };

  const mentioned = normalized.match(/\bmovimiento\s+(?:id\s*)?(\d+)\b/);
  const reference = String(mentioned?.[1] || params.id_ajuste_existente || '');
  if (!/^[1-9]\d*$/.test(reference) || !Number.isSafeInteger(Number(reference))) {
    throw reject('Selecciona el movimiento existente que mostro WMS para confirmar otro ajuste. No inventes un codigo.');
  }
  const [rows] = await db.execute(
    `SELECT m.id, m.producto_id, m.cantidad, m.lote, m.referencia_id,
            m.referencia_tipo, p.siigo_code, op.codigo_orden,
            u.id AS ubicacion_id, u.codigo AS ubicacion
       FROM movimientos m
       JOIN productos p ON p.id = m.producto_id
       JOIN ordenes_produccion op ON op.id = m.referencia_id
       JOIN ubicaciones u ON u.id = COALESCE(m.ubicacion_orig, m.ubicacion_dest)
      WHERE m.id = ? AND m.usuario_id = ?
        AND m.referencia_tipo IN ('consumo_produccion', 'retorno_produccion') LIMIT 1`,
    [Number(reference), userId]
  );
  if (rows.length !== 1) throw reject('No existe un ajuste de materiales propio con ese ID. Selecciona el movimiento que mostro WMS.');
  const base = rows[0];
  const type = base.referencia_tipo === 'consumo_produccion' ? 'ENTREGA_ADICIONAL' : 'DEVOLUCION';
  if ((params.cantidad != null && Number(params.cantidad) !== Number(base.cantidad))
      || (params.tipo && params.tipo !== type)
      || (params.id_orden && ![String(base.referencia_id), base.codigo_orden].includes(String(params.id_orden)))
      || ((params.id_lote || params.lote) && String(params.id_lote || params.lote) !== base.lote)
      || (params.ubicacion_id && Number(params.ubicacion_id) !== Number(base.ubicacion_id))
      || (params.ubicacion && String(params.ubicacion).toUpperCase() !== base.ubicacion.toUpperCase())) {
    throw reject('Los datos no coinciden con el movimiento base. Para un ajuste diferente inicia una nueva solicitud.');
  }
  if (params.id_item || params.sku) {
    const product = await resolveProductReference(db, params.id_item || params.sku);
    if (Number(product.id) !== Number(base.producto_id)) throw reject('El producto no coincide con el movimiento base.');
  }
  return { ...params, id_orden: base.codigo_orden, id_item: base.siigo_code,
    id_lote: base.lote, ubicacion_id: base.ubicacion_id, ubicacion: base.ubicacion,
    tipo: type, cantidad: Number(base.cantidad), confirmar_nuevo_ajuste: true,
    id_ajuste_existente: base.id };
}

module.exports = { materialConfirmationInput };
