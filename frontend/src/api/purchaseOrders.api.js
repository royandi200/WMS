import client from './client'

export const listPurchaseOrders = (params) => client.get('/purchase-orders', { params }).then((r) => r.data)
export const createPurchaseOrder = (body) => client.post('/purchase-orders', body).then((r) => r.data)
export const cancelPurchaseOrder = (id, motivo) => client.patch('/purchase-orders', { id, motivo }).then((r) => r.data)
export const listPurchaseOrderDocumentDrafts = (params = {}) => client
  .get('/warehouse-documents', { params: { ...params, type: 'ORDEN_COMPRA' } })
  .then((r) => r.data)
export const downloadPurchaseOrderDraftDocument = (fileId, filename = 'orden-compra-borrador.pdf') => client
  .get('/warehouse-documents', { params: { file_id: fileId }, responseType: 'blob' })
  .then((response) => downloadBlob(response.data, filename))
export const downloadPurchaseOrderDocument = (documentId, filename = 'orden-compra.pdf') => client
  .get('/purchase-orders', { params: { document_id: documentId }, responseType: 'blob' })
  .then((response) => downloadBlob(response.data, filename))

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
