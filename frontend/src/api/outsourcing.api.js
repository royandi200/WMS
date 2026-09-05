import client from './client'

export const listOutsourcingOrders = (params) => client.get('/outsourcing', { params }).then((r) => r.data)
export const createOutsourcingOrder = (body) => client.post('/outsourcing', { action: 'CREATE', ...body }).then((r) => r.data)
export const linkOutsourcingPurchaseOrder = (body) => client.post('/outsourcing', { action: 'LINK_PURCHASE_ORDER', ...body }).then((r) => r.data)
export const prepareAdditionalOutsourcingShipment = (body) => client.post('/outsourcing', { action: 'PREPARE_ADDITIONAL', ...body }).then((r) => r.data)
export const confirmOutsourcingShipment = (shipmentId) => client.post('/outsourcing', { action: 'CONFIRM_SHIPMENT', envio_id: shipmentId }).then((r) => r.data)
export const cancelOutsourcingShipment = (shipmentId) => client.post('/outsourcing', { action: 'CANCEL_SHIPMENT', envio_id: shipmentId }).then((r) => r.data)
export const listWarehouseDocumentDrafts = (params) => client.get('/warehouse-documents', { params }).then((r) => r.data)
export const downloadWarehouseDocument = (fileId) => client.get('/warehouse-documents', {
  params: { file_id: fileId },
  responseType: 'blob',
})
