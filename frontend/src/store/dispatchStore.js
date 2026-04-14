import { create } from 'zustand'
import { createDispatch } from '../api/dispatch.api'

export const useDispatchStore = create((set) => ({
  loading: false,
  error:   null,
  lastDispatch: null,

  submit: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await createDispatch(body)
      set({ lastDispatch: data, loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al registrar despacho'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
