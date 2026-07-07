import client from './client'

export const listReturns = (params = {}) =>
  client.get('/returns', { params }).then((r) => r.data)

// POST /returns
export const createReturn = (body) =>
  client.post('/returns', body).then((r) => r.data)
