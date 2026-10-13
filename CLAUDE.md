# WMS — instrucciones para Claude

- **Al empezar:** lee `docs/BITACORA.md` (estado, decisiones vigentes, pendientes).
- **Al cerrar cada bloque de trabajo:** actualiza `docs/BITACORA.md` en el mismo commit
  del cambio: ajusta «Estado actual» y «Pendientes», y agrega 2–6 viñetas fechadas al
  inicio del «Registro». Decisiones del cliente o del usuario van a «Decisiones vigentes».
- Stack: API serverless en `api/` (Vercel, Node), frontend React en `frontend/`, MySQL.
  `backend/` y `src/` son históricos y no se despliegan.
- Deploy: push a `main` → Vercel (`wms-seven-ebon.vercel.app`). Producción usa la cuenta
  real de SIIGO: nada de documentos de prueba allí.
- Pruebas: `npm test` en la raíz; build del frontend con `cd frontend && npm run build`.
