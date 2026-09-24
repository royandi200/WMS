import client from './client'

export const listCustomerOrders = (params = {}) => client.get('/customer-orders', { params }).then((r) => r.data)
export const approveCustomerOrder = (documentDraftId, review) => client
  .post('/customer-orders', { document_draft_id: documentDraftId, revision: review }).then((r) => r.data)
export const listCustomerOrderDrafts = () => client
  .get('/warehouse-documents', { params: { type: 'ORDEN_COMPRA_CLIENTE' } }).then((r) => r.data)
export const uploadCustomerOrderPdf = (pdf) => client
  .post('/warehouse-documents', { tipo_documento: 'ORDEN_COMPRA_CLIENTE', documento_pdf: pdf })
  .then((r) => r.data)
export const discardCustomerOrderDraft = (documentDraftId, reason) => client
  .delete('/warehouse-documents', { data: {
    document_draft_id: documentDraftId,
    tipo_documento: 'ORDEN_COMPRA_CLIENTE',
    motivo: reason,
  } }).then((r) => r.data)
export const downloadCustomerOrderPdf = (fileId, filename = 'pedido-cliente.pdf') => client
  .get('/warehouse-documents', { params: { file_id: fileId }, responseType: 'blob' })
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
