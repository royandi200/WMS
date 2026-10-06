import client from './client'

export const createDispatch = (body) => client.post('/dispatch', body)
export const listDispatches = (params) => client.get('/dispatch', { params })
export const confirmDispatch = (body) => client.put('/dispatch', body).then((r) => r.data)
export const syncSiigoInvoices = (body = {}) => client.post('/siigo/import-invoices', body, { timeout: 60000 }).then((r) => r.data)
// Facturas de SIIGO que no pasaron al WMS y sus acciones de corrección.
export const listSiigoInvoiceIssues = (all = false) => client
  .get('/siigo/novedades', { params: all ? { all: 'true' } : {} }).then((r) => r.data)
export const actOnSiigoInvoiceIssue = (body) => client
  .post('/siigo/novedades', body, { timeout: 60000 }).then((r) => r.data)
