import client from './client'

export const authApi = {
  login: async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password })
    return data
  },
  // logout es solo local (limpia el store), no requiere endpoint en el servidor
  logout: () => Promise.resolve(),
  me: async () => {
    const { data } = await client.get('/auth/me')
    return data
  },
}
