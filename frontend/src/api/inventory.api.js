import client from './client'

export const getSummary      = ()       => client.get('/inventory/summary').then(r => r.data)
export const getProductStock = (id)     => client.get(`/inventory/product/${id}`).then(r => r.data)
export const getLotDetail    = (lpn)    => client.get(`/inventory/lot/${lpn}`).then(r => r.data)
export const getKardex       = (params) => client.get('/inventory/kardex', { params }).then(r => r.data)
export const getLowStock     = ()       => client.get('/inventory/low-stock').then(r => r.data)
