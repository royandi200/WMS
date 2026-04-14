import { create } from 'zustand'
import { createReception } from '../api/reception.api'

export const useReceptionStore = create((set) => ({
  loading: false,
  error:   null,
  lastReception: null,

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
