async function receptionLotPartitions(db, reference) {
  const [rows] = await db.execute(
    `SELECT rd.id, rd.lote, COALESCE(rd.lote_proveedor, rd.lote) AS lote_proveedor,
            rd.condicion, rd.cantidad, rd.fecha_venc, rd.motivo,
            r.numero AS recepcion, r.proveedor_nombre, u.codigo AS ubicacion,
            l.id AS lot_id, l.product_id, l.bodega_id, l.qty_current, l.status
       FROM recepcion_distribuciones rd
       JOIN recepciones r ON r.id = rd.recepcion_id AND r.estado = 'completada'
       JOIN lots l ON BINARY l.lpn = BINARY rd.lote
       JOIN recepcion_items ri ON ri.id = rd.recepcion_item_id AND ri.producto_id = l.product_id
       LEFT JOIN ubicaciones u ON u.id = rd.ubicacion_id
      WHERE BINARY COALESCE(rd.lote_proveedor, rd.lote) = BINARY ?
         OR EXISTS (
           SELECT 1 FROM recepcion_distribuciones source
           JOIN recepcion_items si ON si.id = source.recepcion_item_id
           WHERE BINARY source.lote = BINARY ?
             AND si.producto_id = l.product_id
             AND BINARY COALESCE(source.lote_proveedor, source.lote)
                 = BINARY COALESCE(rd.lote_proveedor, rd.lote)
         )
      ORDER BY rd.id`, [reference, reference]
  );
  const identities = new Set(rows.map(row => `${row.product_id}:${row.bodega_id}:${row.lote_proveedor}`));
  if (identities.size > 1) {
    throw Object.assign(new Error('El lote proveedor corresponde a varios productos o bodegas; consulta la partida interna'), { status: 409 });
  }
  return rows;
}

function partitionTraceText(rows) {
  return rows.map(row => [
    `  - Lote proveedor ${row.lote_proveedor} | ${row.condicion}: recibido ${Number(row.cantidad)}`,
    `    ${row.recepcion} | ${row.ubicacion || 'sin ubicacion'}${row.motivo ? ` | ${row.motivo}` : ''}`,
    row.lote !== row.lote_proveedor ? `    Partida interna: ${row.lote}` : null,
  ].filter(Boolean).join('\n')).join('\n');
}

module.exports = { receptionLotPartitions, partitionTraceText };
