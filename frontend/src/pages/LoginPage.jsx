import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'
import WmsLogo from '../components/WmsLogo'
import { useAuthStore } from '../store/authStore'
import { authApi } from '../api/auth.api'

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)

  const { register, handleSubmit, formState: { errors } } = useForm()

  async function onSubmit(data) {
    setServerError('')
    setIsLoading(true)
    try {
      const response = await authApi.login(data.email, data.password)
      setAuth(response.access_token, response.usuario)
    } catch (err) {
      setServerError(err?.response?.data?.error || 'Error al iniciar sesión.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="flex flex-col justify-between w-full max-w-md bg-surface px-10 py-10">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <WmsLogo size={36} />
            <div>
              <span className="text-foreground font-semibold text-lg">WMS</span>
              <p className="text-muted text-xs mt-0.5 font-mono">v1.0.0</p>
            </div>
          </div>
          <div className="mb-8">
            <h1 className="text-foreground text-2xl font-semibold">Bienvenido de nuevo</h1>
            <p className="text-muted text-sm mt-2">Ingrese sus credenciales para acceder al sistema.</p>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-subtle">Correo electrónico</label>
              <input id="email" type="email" autoComplete="email" placeholder="usuario@empresa.com"
                className={`input-field ${errors.email ? 'border-danger' : ''}`}
                {...register('email', { required: 'El correo es requerido', pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Correo inválido' } })} />
              {errors.email && <p className="flex items-center gap-1.5 text-danger text-xs"><AlertCircle size={12} />{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-subtle">Contraseña</label>
              <div className="relative">
                <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                  className={`input-field pr-11 ${errors.password ? 'border-danger' : ''}`}
                  {...register('password', { required: 'La contraseña es requerida', minLength: { value: 6, message: 'Mínimo 6 caracteres' } })} />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-subtle"
                  aria-label={showPassword ? 'Ocultar' : 'Mostrar'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="flex items-center gap-1.5 text-danger text-xs"><AlertCircle size={12} />{errors.password.message}</p>}
            </div>
            {serverError && (
              <div className="flex items-start gap-2.5 bg-danger/10 border border-danger/30 rounded-md px-4 py-3">
                <AlertCircle size={15} className="text-danger mt-0.5 shrink-0" />
                <p className="text-danger text-sm">{serverError}</p>
              </div>
            )}
            <button type="submit" disabled={isLoading} className="btn-primary flex items-center justify-center gap-2 mt-2">
              {isLoading ? <><Loader2 size={16} className="animate-spin" />Ingresando...</> : 'Ingresar al sistema'}
            </button>
          </form>
        </div>
        <div className="mt-10 pt-6 border-t border-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-muted text-xs">Integrado con SIIGO ERP</span>
          </div>
          <p className="text-muted text-xs">Acceso restringido. Solo personal autorizado.</p>
        </div>
      </div>
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-background items-end p-12" aria-hidden="true">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 bg-surface/80 border border-border rounded-full px-4 py-1.5 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-xs text-subtle font-mono">Sistema activo</span>
          </div>
          <h2 className="text-foreground text-3xl font-semibold max-w-sm">Gestión de almacén en tiempo real</h2>
          <p className="text-muted text-sm mt-3 max-w-xs">Recepciones, despachos e inventario sincronizados con SIIGO.</p>
        </div>
      </div>
    </div>
  )
}
