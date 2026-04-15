import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    // Solo cerrar sesión si el 401 viene con mensaje de token inválido/expirado
    // NOT en 404 de endpoints no implementados aún
    if (
      error.response?.status === 401 &&
      error.response?.data?.error &&
      /token|jwt|unauthorized|invalid/i.test(error.response.data.error)
    ) {
      useAuthStore.getState().logout()
    }
    return Promise.reject(error)
  }
)

export default client
