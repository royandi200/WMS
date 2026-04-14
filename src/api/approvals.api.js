import client from './client'

// GET /approvals  — cola de solicitudes pendientes
export const listApprovals = (params = {}) =>
  client.get('/approvals', { params }).then((r) => r.data)

// POST /approvals/approve  — aprobar solicitud
export const approveRequest = (body) =>
  client.post('/approvals/approve', body).then((r) => r.data)

// POST /approvals/reject  — rechazar solicitud
export const rejectRequest = (body) =>
  client.post('/approvals/reject', body).then((r) => r.data)
