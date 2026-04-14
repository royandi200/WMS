import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      usuario: null,
      isAuthenticated: false,
      setAuth: (token, usuario) => set({ token, usuario, isAuthenticated: true }),
      logout: () => set({ token: null, usuario: null, isAuthenticated: false }),
    }),
    {
      name: 'wms-auth',
      partialize: (s) => ({ token: s.token, usuario: s.usuario, isAuthenticated: s.isAuthenticated }),
    }
  )
)
