import client from './client'

export const getPending      = ()     => client.get('/approvals/pending')
export const approveItem     = (body) => client.post('/approvals/approve', body)
export const rejectItem      = (body) => client.post('/approvals/reject', body)
