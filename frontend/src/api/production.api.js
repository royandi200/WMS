import client from './client'

// Rutas activas de Vercel bajo /api/v1.
export const listProductions  = (params) => client.get('/production',                   { params }).then(r => r.data)
export const getProduction    = (id)     => client.get(`/production/${id}`).then(r => r.data)
export const startProduction  = (body)   => client.post('/production/start',             body).then(r => r.data)
export const confirmMaterials = (body)   => client.post('/production/confirm',           body).then(r => r.data)
export const advancePhase     = (body)   => client.post('/production/advance',           body).then(r => r.data)
export const closeProduction  = (body)   => client.post('/production/close',             body).then(r => r.data)
export const adjustMaterials  = (body)   => client.post('/production/material-adjustment', body).then(r => r.data)
