import client from './client'

export const createDispatch = (body) => client.post('/dispatch', body)
export const listDispatches = (params = {}) => client.get('/dispatch', { params })
