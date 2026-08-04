import client from './client'

export const createReception = (body) => client.post('/reception', body)
export const listReceptions = (params) => client.get('/reception', { params })
export const confirmReception = (body) => client.put('/reception', body).then((r) => r.data)
