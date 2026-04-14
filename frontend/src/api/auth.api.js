import client from './client'

export const authApi = {
  /**
   * POST /api/v1/auth/login
   * @returns {{ token: string, usuario: object }}
   */
  login: async (email, password) => {
    const { data } = await client.post('/auth/login', { email, password })
    return data
  },

  /**
   * POST /api/v1/auth/logout
   */
  logout: async () => {
    await client.post('/auth/logout')
  },

  /**
   * GET /api/v1/auth/me
   */
  me: async () => {
    const { data } = await client.get('/auth/me')
    return data
  },
}
