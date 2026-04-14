import client from './client'

export const getWebhookLogs = (params) => client.get('/webhook/logs', { params })
export const getWebhookLog  = (id)     => client.get(`/webhook/logs/${id}`)
