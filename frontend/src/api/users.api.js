import client from './client'

// GET /users
export const listUsers = (params = {}) =>
  client.get('/users', { params }).then((r) => r.data)

// GET /users/:id
export const getUser = (id) =>
  client.get(`/users/${id}`).then((r) => r.data)

// POST /users
export const createUser = (body) =>
  client.post('/users', body).then((r) => r.data)

// PUT /users/:id
export const updateUserRole = (id, role) =>
  client.put('/users', { user_id: id, role }).then((r) => r.data)

// DELETE /users/:id
export const deleteUser = (id) =>
  client.delete(`/users/${id}`).then((r) => r.data)
