import client from './client'

function normalizeOrderReference(value) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^OP\s+ID\s*#?\s*(\d+)$/i)
  return match ? Number(match[1]) : value
}

function withNormalizedOrder(body = {}) {
  return { ...body, order_id: normalizeOrderReference(body.order_id) }
}

// Rutas activas de Vercel bajo /api/v1.
export const listProductions  = (params) => client.get('/production',                   { params }).then(r => r.data)
export const getProduction    = (id)     => client.get(`/production/${normalizeOrderReference(id)}`).then(r => r.data)
export const startProduction  = (body)   => client.post('/production/start',             body).then(r => r.data)
export const confirmMaterials = (body)   => client.post('/production/confirm',           withNormalizedOrder(body)).then(r => r.data)
export const advancePhase     = (body)   => client.post('/production/advance',           withNormalizedOrder(body)).then(r => r.data)
export const closeProduction  = (body)   => client.post('/production/close',             withNormalizedOrder(body)).then(r => r.data)
export const adjustMaterials  = (body)   => client.post('/production/material-adjustment', withNormalizedOrder(body)).then(r => r.data)
export const prepareReplenishment = (body) => client.post('/production/replenishment-prepare', withNormalizedOrder(body)).then(r => r.data)
export const confirmReplenishment = (body) => client.post('/production/replenishment-confirm', withNormalizedOrder(body)).then(r => r.data)
export const cancelReplenishment = (body) => client.post('/production/replenishment-cancel', withNormalizedOrder(body)).then(r => r.data)
