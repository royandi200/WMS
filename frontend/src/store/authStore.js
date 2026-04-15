import { create } from 'zustand'

// Memoria pura: sin localStorage ni sessionStorage.
// Ambos están bloqueados en el iframe sandbox de Vercel (wms-seven-ebon.vercel.app).
// El token sobrevive navegación SPA completa porque el módulo JS permanece montado.
// Solo se pierde en F5 → el usuario vuelve a login (comportamiento correcto con JWT).

export const useAuthStore = create((set) => ({
  token:           null,
  user:            null,
  isAuthenticated: false,

  setAuth: (token, user) => set({ token, user, isAuthenticated: true }),

  logout: () => set({ token: null, user: null, isAuthenticated: false }),
}))
