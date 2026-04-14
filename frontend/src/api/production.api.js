import client from './client'

export const getProductions = (params) => client.get('/production', { params })
export const getProduction  = (id)     => client.get(`/production/${id}`)
export const startOrder     = (body)   => client.post('/production/start', body)
export const confirmOrder   = (body)   => client.post('/production/confirm', body)
export const advanceOrder   = (body)   => client.post('/production/advance', body)
export const closeOrder     = (body)   => client.post('/production/close', body)
