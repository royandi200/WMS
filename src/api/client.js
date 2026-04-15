import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

client.interceptors.response.use(
  (response) => {
    // El API siempre responde { ok: true, data: <payload> }
    // Extraemos .data para que los stores reciban el payload limpio
    // y no el objeto Axios ni el wrapper { ok, data }
    const body = response.data
    if (body && typeof body === 'object' && 'ok' in body) {
      return body.data ?? body
    }
    return body
  },
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(error)
  }
)

export default client
