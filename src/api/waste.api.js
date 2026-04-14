import client from './client'

export const getWastes    = (params) => client.get('/waste', { params })
export const createWaste  = (body)   => client.post('/waste', body)
