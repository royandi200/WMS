import { create } from 'zustand'
import { createReception, listReceptions } from '../api/reception.api'

export const useReceptionStore = create((set) => ({
  loading: false,
  error:   null,
  lastReception: null,
  list: [],

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const res = await listReceptions(params)
      const payload = res?.data?.data ?? res?.data ?? res
      set({ list: payload?.rows || [], loading: false })
      return { ok: true, data: payload?.rows || [] }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al cargar recepciones'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  submit: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await createReception(body)
      set({ lastReception: data, loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al registrar recepción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
