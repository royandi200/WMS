import client from './client'

export const listApprovals  = (params) => client.get('/approvals/pending', { params }).then(r => r.data)
export const approveRequest = (body)   => client.post('/approvals/approve', body).then(r => r.data)
export const rejectRequest  = (body)   => client.post('/approvals/reject', body).then(r => r.data)
