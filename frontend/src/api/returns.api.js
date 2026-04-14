import client from './client'

// POST /returns
export const createReturn = (body) =>
  client.post('/returns', body).then((r) => r.data)
