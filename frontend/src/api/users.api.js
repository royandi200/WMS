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
export const updateUserRoles = (id, roles) =>
  client.put('/users', { user_id: id, roles }).then((r) => r.data)

// Compatibilidad para consumidores antiguos que aun asignan un solo rol.
export const updateUserRole = (id, role) => updateUserRoles(id, [role])

// DELETE /users/:id
export const deleteUser = (id) =>
  client.delete(`/users/${id}`).then((r) => r.data)
