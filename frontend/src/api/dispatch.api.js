import client from './client'

export const createDispatch = (body) => client.post('/dispatch', body)
export const listDispatches = (params) => client.get('/dispatch', { params })
export const confirmDispatch = (body) => client.put('/dispatch', body).then((r) => r.data)
export const syncSiigoInvoices = (body = {}) => client.post('/siigo/import-invoices', body).then((r) => r.data)
