import client from './client'

export const authApi = {
  // El interceptor ya extrae body completo del servidor.
  // El servidor devuelve { ok, access_token, refresh_token, usuario }
  // No envolver en { data } — recibir directo.
  login: async (email, password) => {
    const res = await client.post('/auth/login', { email, password })
    // res puede ser el body completo { ok, access_token, usuario }
    // o si el interceptor lo pasó por body.data, verificar ambos
    return res
  },
  logout: async () => {
    try { await client.post('/auth/logout') } catch (_) {}
  },
  me: async () => {
    const res = await client.get('/auth/me')
    return res
  },
}
