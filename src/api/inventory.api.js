import client from './client'

// GET /inventory/summary  — totales globales de stock
export const getSummary = () =>
  client.get('/inventory/summary').then((r) => r.data)

// GET /inventory/product/:id  — stock de un producto (por iditem o SKU)
export const getProductStock = (id) =>
  client.get(`/inventory/product/${id}`).then((r) => r.data)

// GET /inventory/lot/:lpn  — detalle de un lote por LPN
export const getLotDetail = (lpn) =>
  client.get(`/inventory/lot/${lpn}`).then((r) => r.data)

// GET /inventory/kardex?sku=&page=&limit=
export const getKardex = (params = {}) =>
  client.get('/inventory/kardex', { params }).then((r) => r.data)

// GET /inventory/low-stock  — productos bajo mínimo
export const getLowStock = () =>
  client.get('/inventory/low-stock').then((r) => r.data)
