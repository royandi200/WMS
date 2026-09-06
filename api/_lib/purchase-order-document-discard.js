function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePurchaseOrderDocumentDiscard(body = {}) {
  const id = Number(body.id || body.document_draft_id || body.documento_borrador_id || 0);
  const reason = String(body.motivo || body.reason || '').trim().replace(/\s+/g, ' ');
  if (!Number.isInteger(id) || id < 1) throw httpError(400, 'Borrador de orden de compra invalido');
  if (reason.length < 5) throw httpError(400, 'El motivo para descartar el borrador es obligatorio');
  if (reason.length > 300) throw httpError(400, 'El motivo para descartar el borrador supera 300 caracteres');
  return { id, reason };
}

async function discardPurchaseOrderDocumentDraft(conn, { id, reason, userId }) {
  const [drafts] = await conn.execute(
    `SELECT id, referencia_documento, estado, orden_compra_id, maquila_envio_id
       FROM documentos_bodega_borrador
      WHERE id = ? AND tipo_documento = 'ORDEN_COMPRA'
      LIMIT 1 FOR UPDATE`,
    [id]
  );
  if (!drafts.length) throw httpError(404, 'Borrador de orden de compra no encontrado');
  const draft = drafts[0];

  if (draft.estado === 'DESCARTADO') {
    return { id, referencia_documento: draft.referencia_documento, estado: 'DESCARTADO', duplicate: true };
  }
  if (draft.orden_compra_id || draft.maquila_envio_id || draft.estado === 'VINCULADO') {
    throw httpError(409, `El borrador ${draft.referencia_documento} ya esta vinculado y no se puede descartar`);
  }
  if (!['PENDIENTE_REVISION', 'REQUIERE_CORRECCION'].includes(draft.estado)) {
    throw httpError(409, `El borrador ${draft.referencia_documento} no se puede descartar en estado ${draft.estado}`);
  }

  const [updated] = await conn.execute(
    `UPDATE documentos_bodega_borrador
        SET estado = 'DESCARTADO', revisado_por = ?, revisado_en = NOW(), actualizado_en = NOW()
      WHERE id = ? AND estado IN ('PENDIENTE_REVISION', 'REQUIERE_CORRECCION')
        AND orden_compra_id IS NULL AND maquila_envio_id IS NULL`,
    [userId, id]
  );
  if (updated.affectedRows !== 1) {
    throw httpError(409, 'El borrador cambio de estado mientras se intentaba descartar');
  }

  await conn.execute(
    `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
     VALUES ('warehouse_documents', 'INFO', ?, ?, ?, NOW())`,
    [
      `Borrador de orden de compra ${draft.referencia_documento} descartado`,
      userId,
      JSON.stringify({
        documento_borrador_id: id,
        referencia_documento: draft.referencia_documento,
        estado_anterior: draft.estado,
        motivo: reason,
      }),
    ]
  );

  return {
    id,
    referencia_documento: draft.referencia_documento,
    estado: 'DESCARTADO',
    motivo: reason,
    duplicate: false,
  };
}

module.exports = {
  discardPurchaseOrderDocumentDraft,
  normalizePurchaseOrderDocumentDiscard,
};
