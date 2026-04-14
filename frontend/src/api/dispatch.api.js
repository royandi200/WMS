import client from './client'

export const createDispatch = (body) => client.post('/dispatch', body)
