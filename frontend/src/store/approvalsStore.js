import { create } from 'zustand'
import { listApprovals, approveRequest, rejectRequest } from '../api/approvals.api'

export const useApprovalsStore = create((set, get) => ({
  list:    [],
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const data = await listApprovals(params)
      set({ list: data.rows || data, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar aprobaciones', loading: false })
    }
  },

  approve: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await approveRequest(body)
      set((s) => ({
        list: s.list.filter((i) => i.id !== body.id),
        loading: false,
      }))
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al aprobar solicitud'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  reject: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await rejectRequest(body)
      set((s) => ({
        list: s.list.filter((i) => i.id !== body.id),
        loading: false,
      }))
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al rechazar solicitud'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
