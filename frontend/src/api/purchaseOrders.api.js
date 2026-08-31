import client from './client'

export const listPurchaseOrders = (params) => client.get('/purchase-orders', { params }).then((r) => r.data)
export const createPurchaseOrder = (body) => client.post('/purchase-orders', body).then((r) => r.data)
export const downloadPurchaseOrderDocument = (documentId, filename = 'orden-compra.pdf') => client
  .get('/purchase-orders', { params: { document_id: documentId }, responseType: 'blob' })
  .then((response) => {
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  })
