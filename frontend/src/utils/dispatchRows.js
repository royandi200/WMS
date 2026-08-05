export function groupDispatchRows(rows = []) {
  const dispatches = new Map()

  for (const row of rows) {
    const key = String(row.id)
    if (!dispatches.has(key)) {
      dispatches.set(key, { ...row, cantidad: 0, items: [] })
    }

    const dispatch = dispatches.get(key)
    const quantity = Number(row.cantidad || 0)
    dispatch.cantidad += quantity

    if (row.producto_id || row.sku || row.lote) {
      dispatch.items.push({
        producto_id: row.producto_id,
        sku: row.sku,
        producto_nombre: row.producto_nombre,
        lote: row.lote,
        ubicacion: row.ubicacion,
        cantidad: quantity,
        cantidad_solicitada: Number(row.cantidad_solicitada || 0),
        cantidad_despachada: Number(row.cantidad_despachada || 0),
      })
    }
  }

  for (const dispatch of dispatches.values()) {
    const skus = [...new Set(dispatch.items.map((item) => item.sku).filter(Boolean))]
    const lots = [...new Set(dispatch.items.map((item) => item.lote).filter(Boolean))]
    dispatch.sku = skus.length > 1 ? `${skus.length} SKU` : (skus[0] || dispatch.sku || null)
    dispatch.producto_nombre = dispatch.items.length === 1 ? dispatch.items[0].producto_nombre : ''
    dispatch.lote = lots.length > 1 ? `${lots.length} lotes` : (lots[0] || dispatch.lote || null)
  }

  return [...dispatches.values()]
}
