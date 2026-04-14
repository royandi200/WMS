import client from './client'

export const getSummary       = ()             => client.get('/inventory/summary')
export const getProductStock  = (id)           => client.get(`/inventory/product/${id}`)
export const getLotDetail     = (lpn)          => client.get(`/inventory/lot/${lpn}`)
export const getKardex        = (params)       => client.get('/inventory/kardex', { params })
export const getLowStock      = ()             => client.get('/inventory/low-stock')
