import client from './client'

export const authApi = {
  login: async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password })
    return data
  },
  me: async () => {
    const { data } = await client.get('/auth/me')
    return data
  },
}
