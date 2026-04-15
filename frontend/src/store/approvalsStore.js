import { create } from 'zustand'
import { listApprovals, approveRequest, rejectRequest } from '../api/approvals.api'

// Backend retorna { ok, data: { rows, total } }
// Axios envuelve en response.data → res = { ok, data: { rows, total } }
const extractRows = (res) => {
  if (Array.isArray(res))              return res
  if (Array.isArray(res?.rows))        return res.rows
  if (Array.isArray(res?.data?.rows))  return res.data.rows
  if (Array.isArray(res?.data))        return res.data
  return []
}

export const useApprovalsStore = create((set) => ({
  list:    [],
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const res = await listApprovals(params)
      // res es el objeto axios response.data completo
      set({ list: extractRows(res), loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || e.response?.data?.message || 'Error al cargar aprobaciones', loading: false })
    }
  },

  approve: async (body) => {
    set({ loading: true, error: null })
    try {
      await approveRequest(body)
      set((s) => ({ list: s.list.filter((i) => i.id !== body.id), loading: false }))
      return { ok: true }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al aprobar solicitud'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  reject: async (body) => {
    set({ loading: true, error: null })
    try {
      await rejectRequest(body)
      set((s) => ({ list: s.list.filter((i) => i.id !== body.id), loading: false }))
      return { ok: true }
    } catch (e) {
      const msg = e.response?.data?.error || e.response?.data?.message || 'Error al rechazar solicitud'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
