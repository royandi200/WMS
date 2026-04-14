import client from './client'

export const authApi = {
  login: async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password })
    return data
  },
  logout: async () => {
    await client.post('/auth/logout')
  },
  me: async () => {
    const { data } = await client.get('/auth/me')
    return data
  },
}
