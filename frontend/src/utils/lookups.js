import { getProducts } from '../api/products.api'
import { getProductStock, listUbicaciones } from '../api/inventory.api'
import { listProductions } from '../api/production.api'
import { listDispatches } from '../api/dispatch.api'

// Fuentes para AutocompleteInput. Son funciones estables (nivel de módulo) para
// que el componente no repita consultas en cada render.

const normalize = (value) => String(value ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const matches = (query, ...fields) => {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  const haystack = normalize(fields.join(' '))
  return words.every(word => haystack.includes(word))
}

const formatQty = (value) => Number(value || 0).toLocaleString('es-CO', { maximumFractionDigits: 4 })

export async function searchProducts(query) {
  const response = await getProducts({ search: query, limit: 12 })
  const rows = response?.data?.data?.rows || response?.data?.rows || []
  return rows.map(row => ({
    value: row.sku,
    label: row.name,
    hint: `Disponible: ${formatQty(row.disponible)} ${row.unit || ''}`.trim(),
  }))
}

let locationsCache = null
let locationsLoadedAt = 0
async function loadLocations() {
  if (!locationsCache || Date.now() - locationsLoadedAt > 5 * 60 * 1000) {
    const response = await listUbicaciones()
    locationsCache = response?.data?.rows || []
    locationsLoadedAt = Date.now()
  }
  return locationsCache
}

export async function searchLocations(query) {
  const rows = await loadLocations()
  return rows
    .filter(row => matches(query, row.codigo, row.zona, row.bodega_codigo))
    .map(row => ({ value: row.codigo, label: row.zona || '', hint: row.bodega_nombre || row.bodega_codigo || '' }))
}

// Lotes con saldo de un SKU. Devuelve una función estable por SKU.
const lotSearchers = new Map()
export function lotSearchFor(sku) {
  const key = String(sku || '').trim()
  if (!key) return async () => []
  if (!lotSearchers.has(key)) {
    let cache = null
    lotSearchers.set(key, async (query) => {
      if (!cache) {
        const response = await getProductStock(key)
        cache = response?.data?.rows || []
        setTimeout(() => { cache = null }, 60 * 1000)
      }
      const seen = new Set()
      return cache
        .filter(row => row.lote && matches(query, row.lote, row.lote_proveedor, row.ubicacion_codigo))
        .filter(row => { const id = `${row.lote}|${row.ubicacion_codigo}`; if (seen.has(id)) return false; seen.add(id); return true })
        .map(row => ({
          value: row.lote,
          location: row.ubicacion_codigo || '',
          label: row.ubicacion_codigo ? `en ${row.ubicacion_codigo}` : '',
          hint: [
            `Disponible: ${formatQty(row.disponible)}`,
            row.lot_status && row.lot_status !== 'DISPONIBLE' ? row.lot_status : null,
            (row.expiry_date || row.fecha_venc) ? `vence ${String(row.expiry_date || row.fecha_venc).slice(0, 10)}` : null,
          ].filter(Boolean).join(' · '),
        }))
    })
  }
  return lotSearchers.get(key)
}

// Despachos ya entregados (origen de una devolución), agrupados por factura.
let dispatchCache = null
let dispatchLoadedAt = 0
async function loadDispatched() {
  if (!dispatchCache || Date.now() - dispatchLoadedAt > 60 * 1000) {
    const response = await listDispatches({ limit: 200 })
    const rows = (response?.data?.data?.rows || []).filter(row => row.estado === 'despachado' && row.source_type !== 'MAQUILA_3Q')
    const byReference = new Map()
    for (const row of rows) {
      const reference = row.siigo_invoice_name || row.numero
      if (!reference) continue
      if (!byReference.has(reference)) byReference.set(reference, { reference, numero: row.numero, cliente: row.cliente_nombre, items: [] })
      if (row.sku) byReference.get(reference).items.push({ sku: row.sku, producto: row.producto_nombre, lote: row.lote, cantidad: row.cantidad })
    }
    dispatchCache = [...byReference.values()]
    dispatchLoadedAt = Date.now()
  }
  return dispatchCache
}

const findDispatch = async (reference) => {
  const key = normalize(reference)
  if (!key) return null
  return (await loadDispatched()).find(item => normalize(item.reference) === key || normalize(item.numero) === key) || null
}

export async function searchDispatchedInvoices(query) {
  return (await loadDispatched())
    .filter(item => matches(query, item.reference, item.numero, item.cliente))
    .map(item => ({
      value: item.reference,
      label: item.cliente || '',
      cliente: item.cliente || '',
      hint: item.items.map(i => `${i.sku} × ${formatQty(i.cantidad)}`).join(' · '),
    }))
}

// SKU y lotes del despacho elegido; sin despacho, cae al catálogo general.
const dispatchSkuSearchers = new Map()
export function dispatchSkuSearchFor(reference) {
  const key = String(reference || '').trim()
  if (!key) return searchProducts
  if (!dispatchSkuSearchers.has(key)) {
    dispatchSkuSearchers.set(key, async (query) => {
      const dispatch = await findDispatch(key)
      if (!dispatch) return searchProducts(query)
      const seen = new Set()
      return dispatch.items
        .filter(item => matches(query, item.sku, item.producto) && !seen.has(item.sku) && seen.add(item.sku))
        .map(item => ({ value: item.sku, label: item.producto || '', hint: `Despachado en ${dispatch.reference}` }))
    })
  }
  return dispatchSkuSearchers.get(key)
}

const dispatchLotSearchers = new Map()
export function dispatchLotSearchFor(reference, sku) {
  const key = `${String(reference || '').trim()}|${String(sku || '').trim()}`
  if (!String(reference || '').trim()) return lotSearchFor(sku)
  if (!dispatchLotSearchers.has(key)) {
    dispatchLotSearchers.set(key, async (query) => {
      const dispatch = await findDispatch(reference)
      if (!dispatch) return lotSearchFor(sku)(query)
      return dispatch.items
        .filter(item => item.lote && (!sku || normalize(item.sku) === normalize(sku)) && matches(query, item.lote))
        .map(item => ({ value: item.lote, label: item.sku, hint: `Despachadas: ${formatQty(item.cantidad)}` }))
    })
  }
  return dispatchLotSearchers.get(key)
}

let ordersCache = null
let ordersLoadedAt = 0
export async function searchProductionOrders(query) {
  if (!ordersCache || Date.now() - ordersLoadedAt > 60 * 1000) {
    const response = await listProductions({ limit: 100 })
    ordersCache = response?.data?.rows || []
    ordersLoadedAt = Date.now()
  }
  const plain = String(query).replace(/^op\s*(?:id)?\s*#?\s*/i, '')
  return ordersCache
    .filter(row => matches(plain, row.id, row.codigo_orden, row.sku, row.product_name, row.estado))
    .map(row => ({
      value: `OP ID ${row.id}`,
      label: row.codigo_orden,
      hint: `${row.sku || ''} ${row.product_name || ''} · ${Number(row.cantidad_planeada || 0)} und · ${row.estado}`.trim(),
    }))
}
