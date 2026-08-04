import client from './client'

export const listPurchaseOrders = (params) => client.get('/purchase-orders', { params }).then((r) => r.data)
export const createPurchaseOrder = (body) => client.post('/purchase-orders', body).then((r) => r.data)
