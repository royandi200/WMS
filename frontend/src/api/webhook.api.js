import client from './client'

export const getWebhookLogs      = (params) => client.get('/webhook/logs', { params }).then(r => r.data)
export const getWebhookLogDetail = (id)     => client.get(`/webhook/logs/${id}`).then(r => r.data)
