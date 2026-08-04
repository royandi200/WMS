# Validacion de flujos de bodega - 2026-08-04

## Alcance ejecutado

- Auditoria estandar con la skill `wms-security-audit`.
- Revision de API Vercel, frontend, migraciones MySQL, BuilderBot y servicios Siigo.
- Pruebas unitarias de capacidades, flags, OC, distribuciones de recepcion, telefonos y notificaciones.
- Build de produccion del frontend.
- Consultas de invariantes sobre la base compartida.
- Smokes no destructivos de idempotencia.
- Smoke completo de produccion con un SKU real del cliente y fixtures QA trazables.

## Resultados comprobados

### Base de datos

- Migraciones `07` a `10` aplicadas.
- Cero filas con stock negativo, reserva negativa o reserva superior a cantidad.
- Cero demandas de despacho con cantidades invalidas.
- Cero claves duplicadas de notificacion.
- Antes del smoke, las tablas nuevas no contenian operaciones, lo que permitio aislar los resultados.

### Produccion

- `00102-PTASH60` se bloqueo inicialmente por faltantes reales de `00004-TPALB`, `00007-TRG` y `00017-ETASH60`.
- Se crearon lotes QA `WMSFLOW-QA-*` para esos tres empaques.
- OP valida inicial: `OP-20260804-6653`.
- FEFO vigente selecciono `TEST_AGENT-MPASH-FIFO-NEW`, vence 2026-09-30, ubicacion `PPAL-A-1-02`.
- Se confirmaron cuatro materiales por lote y ubicacion.
- Se registro entrega adicional de `0.25` y devolucion de `0.1` de `00051-MPASH`.
- Conciliacion final de MPASH: teorico `1`, consumo neto `1.15`, variacion `+0.15`.
- Se creo una unidad de `00102-PTASH60` en `PPAL-A-1-01` con lote `LPN-OP-20260804-6653`.
- Repetir el cierre devolvio `already_closed=true` sin duplicar inventario.
- Tras ajustar el consecutivo, un segundo smoke completo genero `OP-20260804-000057` y volvio a aprobar liberacion, FEFO vigente, confirmacion, ajustes de materiales, cierre, conciliacion e idempotencia.

### Recepcion

- OC QA: `OC-WMSFLOW-1785872271826`, SKU real `00004-TPALB`, cantidad `5`.
- Factura de compra sintetica importada como recepcion `REC-SIIGO-FC-WMSFLOW-1785872`.
- Conciliacion: OC `5`, factura `5`, fisico `5`; diferencias cuantitativas `0`.
- Clasificacion fisica: `3` disponibles, `1` en cuarentena y `1` rechazado.
- Solo el lote disponible creo stock por `3` unidades.
- Los lotes de cuarentena y rechazo quedaron trazables con sus estados, motivos y sin stock disponible.
- Repetir la confirmacion devolvio `already_completed=true` y no creo movimientos nuevos.

### Despacho

- Factura QA: `FV-WMSFLOW-1785872374439`, SKU `00102-PTASH60`, cantidad `1`.
- Se creo la tarea `DSP-SIIGO-FV-WMSFLOW-1785872` con cliente final y estado `picking`.
- FEFO reservo el lote `TEST_AGENT-PTASH-DISP` por una unidad.
- Antes de confirmar: stock `90`, reservado `1`, saldo de lote `90`.
- Despues de confirmar: stock `89`, reservado `0`, saldo de lote `89`.
- Repetir la confirmacion devolvio `already_completed=true` sin un segundo descuento.

### Hallazgo corregido durante el smoke

La primera OP QA (`OP-20260804-6062`) revelo que produccion ordenaba FEFO, pero no excluia lotes vencidos. Esa OP consumio el lote de prueba `TEST_AGENT-MPASH-EXPIRED` antes del fix. El servicio ahora exige:

- estado de lote `DISPONIBLE`;
- ubicacion activa;
- vencimiento nulo o mayor/igual a la fecha actual.

La segunda ejecucion confirmo que el lote vencido dejo de ser elegible.

### Idempotencia

- Reintento de OP cerrada: no modifico stock ni reservas.
- Reintento de despacho Siigo ya completado: no modifico stock ni reservas.
- Totales antes y despues del smoke no destructivo: cantidad `13197.3850`, reservado `1070.8000`.

### Automatizacion

- `npm test`: 11 pruebas aprobadas.
- `npm run build`: build Vite aprobado.
- `npm run test:workflow:live`: smoke integrado aprobado.
- `npm run test:reception:live`: smoke de OC, factura y recepcion aprobado.
- `npm run test:dispatch:live`: smoke de factura, reserva y despacho aprobado.
- API JavaScript: sintaxis validada con `node --check`.
- `git diff --check`: sin errores en archivos del cambio; solo existe una linea final en blanco en `docs/agent-dashboard-qa-plan.md`, modificada por el usuario y excluida del alcance.

## Seguridad

### Corregido

- Capacidades centralizadas y verificacion del rol vigente en cada request.
- Rutas criticas de dashboard y WhatsApp comparten servicios transaccionales.
- Bloqueo por defecto de recepcion manual y despacho libre.
- Operaciones destructivas idempotentes y con `FOR UPDATE`.
- Cuarentena/rechazo no crean stock disponible.
- Telefonos en resultados de notificacion se enmascaran.
- Notificaciones nuevas son opt-in y no se envian durante pruebas automatizadas.
- No se encontraron secretos reales versionados.
- API: cero vulnerabilidades npm de produccion.

### Riesgos residuales

1. Alto: el webhook aun admite `kw=g0m@s` como autenticacion de compatibilidad si BuilderBot no envia el secreto. Un atacante que conozca un telefono registrado podria falsificar el origen. Antes de produccion debe configurarse `X-BuilderBot-Secret` y retirarse el fallback por keyword.
2. Alto operativo: la base tiene nueve usuarios activos con rol `recepcion_cierre`, ninguno con `alistador` y ninguno con `despacho`. No habilitar notificaciones hasta corregirlo.
3. Medio: los despachos parciales no tienen completo el ciclo de reservas posteriores. La bandera debe permanecer en `false`.
4. Medio: una OC se trata actualmente como una recepcion/factura principal. Falta definir y probar multiples facturas o recepciones parciales contra la misma OC.
5. Medio: MySQL puede usar TLS con `rejectUnauthorized=false`; se debe instalar/verificar la CA del proveedor antes de exigir validacion completa.
6. Bajo/contextual: React Router 7.18 corrige los avisos que afectaban navegacion. npm reporta un aviso RSC, pero el WMS usa modo declarativo cliente y no usa RSC ni acciones de servidor.

## Preparacion antes de desplegar

1. Asignar los cuatro responsables reales desde Usuarios y roles.
2. Mantener `ENABLE_WORKFLOW_NOTIFICATIONS=false` durante el primer despliegue.
3. Cargar el prompt actualizado en BuilderBot.
4. Desplegar Vercel y validar login, `/api/v1/users`, OC, recepcion, produccion, notificaciones y despacho.
5. Probar mensajes con un evento por rol; confirmar destinatario y luego habilitar notificaciones.
6. Configurar secreto de webhook en BuilderBot y eliminar el fallback por keyword antes de datos productivos.
