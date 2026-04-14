import client from './client'

export const createReception = (body) => client.post('/reception', body)
