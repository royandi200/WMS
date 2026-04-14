import client from './client'

// GET /webhook/logs?page=&limit=&from_phone=&action=&status=
export const getWebhookLogs = (params = {}) =>
  client.get('/webhook/logs', { params }).then((r) => r.data)

// GET /webhook/logs/:id  — detalle de un log
export const getWebhookLogDetail = (id) =>
  client.get(`/webhook/logs/${id}`).then((r) => r.data)
