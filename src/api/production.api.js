import client from './client'

// POST /production/start
export const startProduction = (body) =>
  client.post('/production/start', body).then((r) => r.data)

// POST /production/confirm-materials
export const confirmMaterials = (body) =>
  client.post('/production/confirm-materials', body).then((r) => r.data)

// POST /production/advance-phase
export const advancePhase = (body) =>
  client.post('/production/advance-phase', body).then((r) => r.data)

// POST /production/close
export const closeProduction = (body) =>
  client.post('/production/close', body).then((r) => r.data)

// GET /production?page=&limit=
export const listProductions = (params = {}) =>
  client.get('/production', { params }).then((r) => r.data)

// GET /production/:id
export const getProduction = (id) =>
  client.get(`/production/${id}`).then((r) => r.data)
