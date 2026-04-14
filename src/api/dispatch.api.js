import client from './client'

/**
 * POST /dispatch
 * body: { iditem, cantidad, destino, orden_venta? }
 */
export const createDispatch = (body) =>
  client.post('/dispatch', body).then((r) => r.data)
