import { create } from 'zustand'
import {
  startProduction,
  confirmMaterials,
  advancePhase,
  closeProduction,
  listProductions,
  getProduction,
} from '../api/production.api'

export const useProductionStore = create((set) => ({
  list:    [],
  current: null,
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const data = await listProductions(params)
      set({ list: data.rows || data, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.message || 'Error al cargar producciones', loading: false })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null })
    try {
      const data = await getProduction(id)
      set({ current: data, loading: false })
      return data
    } catch (e) {
      set({ error: e.response?.data?.message || 'Orden no encontrada', loading: false })
      return null
    }
  },

  start: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await startProduction(body)
      set({ loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al iniciar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  confirm: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await confirmMaterials(body)
      set({ loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al confirmar materiales'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  advance: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await advancePhase(body)
      set({ loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al avanzar fase'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  close: async (body) => {
    set({ loading: true, error: null })
    try {
      const data = await closeProduction(body)
      set({ loading: false })
      return { ok: true, data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al cerrar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
