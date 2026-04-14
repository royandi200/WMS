import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      usuario: null,
      isAuthenticated: false,

      setAuth: (token, usuario) =>
        set({ token, usuario, isAuthenticated: true }),

      logout: () =>
        set({ token: null, usuario: null, isAuthenticated: false }),
    }),
    {
      name: 'wms-auth',
      partialize: (state) => ({
        token: state.token,
        usuario: state.usuario,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
