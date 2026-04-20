import { create } from 'zustand'
import { listApprovals, approveRequest, rejectRequest } from '../api/approvals.api'

const extractRows = (res) => {
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.rows)) return res.rows
  if (Array.isArray(res?.data?.rows)) return res.data.rows
  if (Array.isArray(res?.data)) return res.data
  return []
}

export const useApprovalsStore = create((set, get) => ({
  pendingList: [],
  historyList: [],
  loadingPending: false,
  loadingHistory: false,
  error: null,

  fetchPending: async (params = {}) => {
    set({ loadingPending: true, error: null })
    try {
      const res = await listApprovals({ ...params, estado: 'PENDIENTE' })
      set({ pendingList: extractRows(res), loadingPending: false })
    } catch (e) {
      set({
        error: e.response?.data?.error || e.response?.data?.message || 'Error al cargar aprobaciones pendientes',
        loadingPending: false,
      })
    }
  },

  fetchHistory: async (params = {}) => {
    set({ loadingHistory: true, error: null })
    try {
      const res = await listApprovals({ ...params, estado: params.estado || 'HISTORIAL' })
      set({ historyList: extractRows(res), loadingHistory: false })
    } catch (e) {
      set({
        error: e.response?.data?.error || e.response?.data?.message || 'Error al cargar histórico de aprobaciones',
        loadingHistory: false,
      })
    }
  },

  approve: async (body) => {
    set({ error: null })
    try {
      await approveRequest(body)
      set((s) => ({
        pendingList: s.pendingList.filter((i) => i.codigo_solicitud !== body.request_code),
      }))
      await get().fetchHistory({ limit: 50 })
      return { ok: true }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al aprobar solicitud'
      set({ error: msg })
      return { ok: false, message: msg }
    }
  },

  reject: async (body) => {
    set({ error: null })
    try {
      await rejectRequest(body)
      set((s) => ({
        pendingList: s.pendingList.filter((i) => i.codigo_solicitud !== body.request_code),
      }))
      await get().fetchHistory({ limit: 50 })
      return { ok: true }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al rechazar solicitud'
      set({ error: msg })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
