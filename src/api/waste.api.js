import client from './client'

// POST /waste
export const reportWaste = (body) =>
  client.post('/waste', body).then((r) => r.data)

// GET /waste?page=&limit=
export const listWaste = (params = {}) =>
  client.get('/waste', { params }).then((r) => r.data)
