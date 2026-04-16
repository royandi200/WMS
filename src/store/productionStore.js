import { create } from 'zustand'
import {
  getProductions,
  getProduction,
  startOrder,
  confirmOrder,
  advanceOrder,
  closeOrder,
} from '../api/production.api'

export const useProductionStore = create((set) => ({
  list:    [],
  current: null,
  loading: false,
  error:   null,

  fetchList: async (params = {}) => {
    set({ loading: true, error: null })
    try {
      const res  = await getProductions(params)
      const data = res.data
      // API devuelve { ok, data: { rows, total } }
      const rows = data?.data?.rows ?? data?.rows ?? data ?? []
      // Normalizar nombres de campo: la BD usa codigo_orden, cantidad_planeada, etc.
      const normalized = rows.map((r) => ({
        ...r,
        id:           r.id,
        product_id:   r.producto_id   ?? r.product_id,
        product_name: r.product_name  ?? r.nombre,
        sku:          r.sku           ?? r.siigo_code,
        qty_planned:  r.cantidad_planeada ?? r.qty_planned,
        qty_real:     r.cantidad_real     ?? r.qty_real,
        current_phase:r.fase              ?? r.current_phase,
        status:       r.estado            ?? r.status,
        created_at:   r.creado_en         ?? r.created_at,
        codigo_orden: r.codigo_orden,
      }))
      set({ list: normalized, loading: false })
    } catch (e) {
      set({ error: e.response?.data?.error || e.response?.data?.message || 'Error al cargar producciones', loading: false })
    }
  },

  fetchOne: async (id) => {
    set({ loading: true, error: null })
    try {
      const res  = await getProduction(id)
      const data = res.data?.data ?? res.data
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
      const res = await startOrder(body)
      set({ loading: false })
      return { ok: true, data: res.data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al iniciar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  confirm: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await confirmOrder(body)
      set({ loading: false })
      return { ok: true, data: res.data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al confirmar materiales'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  advance: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await advanceOrder(body)
      set({ loading: false })
      return { ok: true, data: res.data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al avanzar fase'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  close: async (body) => {
    set({ loading: true, error: null })
    try {
      const res = await closeOrder(body)
      set({ loading: false })
      return { ok: true, data: res.data }
    } catch (e) {
      const msg = e.response?.data?.message || 'Error al cerrar producción'
      set({ error: msg, loading: false })
      return { ok: false, message: msg }
    }
  },

  clearError: () => set({ error: null }),
}))
