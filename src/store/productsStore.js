import { create } from 'zustand'
import * as api from '../api/products.api'

// Garantiza que el resultado siempre sea un array,
// sin importar si la respuesta viene como { rows, total } o como array directo.
const toArray = (data) => {
  if (Array.isArray(data))        return data
  if (Array.isArray(data?.rows))  return data.rows
  if (Array.isArray(data?.data))  return data.data
  return []
}

export const useProductsStore = create((set, get) => ({
  list:    [],
  detail:  null,
  loading: false,
  error:   null,
  filters: { search: '', type: '', active: 'true', page: 1 },

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  clearError: () => set({ error: null }),

  fetchList: async (overrides = {}) => {
    set({ loading: true, error: null })
    try {
      const params = { ...get().filters, ...overrides }
      const { data } = await api.getProducts(params)
      set({ list: toArray(data), loading: false })
    } catch (e) {
      set({ error: e.response?.data?.message ?? 'Error al cargar productos', loading: false })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null, detail: null })
    try {
      const { data } = await api.getProduct(id)
      set({ detail: data, loading: false })
      return data
    } catch (e) {
      set({ error: e.response?.data?.message ?? 'Producto no encontrado', loading: false })
      return null
    }
  },

  create: async (body) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.createProduct(body)
      set((s) => ({ list: [data, ...s.list], loading: false }))
      return { ok: true, data }
    } catch (e) {
      const message = e.response?.data?.message ?? 'Error al crear producto'
      set({ error: message, loading: false })
      return { ok: false, message }
    }
  },

  update: async (id, body) => {
    set({ loading: true, error: null })
    try {
      const { data } = await api.updateProduct(id, body)
      set((s) => ({ list: s.list.map((p) => p.id === id ? data : p), detail: data, loading: false }))
      return { ok: true, data }
    } catch (e) {
      const message = e.response?.data?.message ?? 'Error al actualizar producto'
      set({ error: message, loading: false })
      return { ok: false, message }
    }
  },

  toggle: async (id) => {
    try {
      await api.toggleProduct(id)
      set((s) => ({ list: s.list.map((p) => p.id === id ? { ...p, active: !p.active } : p) }))
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e.response?.data?.message ?? 'Error' }
    }
  },
}))
