import client from './client'

export const createReception = (body) => client.post('/reception', body)
export const listReceptions = (params) => client.get('/reception', { params })
export const prepareReceptionFromPurchaseOrder = (purchaseOrderId) => client
  .post('/reception', { action: 'PREPARAR_DESDE_OC', orden_compra_id: purchaseOrderId })
  .then((r) => r.data)
export const prepareReceptionFromOutsourcing = (outsourcingOrderId, deliveryQuantity) => client
  .post('/reception', {
    action: 'PREPARAR_DESDE_MAQUILA',
    orden_maquila_id: outsourcingOrderId,
    cantidad_entrega: deliveryQuantity,
  })
  .then((r) => r.data)
export const confirmReception = (body) => client.put('/reception', body).then((r) => r.data)
