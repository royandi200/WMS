import client from './client'

/**
 * POST /reception
 * body: { iditem, cantidad, cantidad_mala, proveedor, lote?, ubicacion? }
 */
export const createReception = (body) =>
  client.post('/reception', body).then((r) => r.data)
