import client from './client'

// Rutas reales del backend Express (backend/src/modules/production/production.routes.js)
export const listProductions  = (params) => client.get('/production',                   { params }).then(r => r.data)
export const getProduction    = (id)     => client.get(`/production/${id}`).then(r => r.data)
export const startProduction  = (body)   => client.post('/production/start',             body).then(r => r.data)
export const confirmMaterials = (body)   => client.post('/production/confirm-materials', body).then(r => r.data)
export const advancePhase     = (body)   => client.post('/production/advance-phase',     body).then(r => r.data)
export const closeProduction  = (body)   => client.post('/production/close',             body).then(r => r.data)
