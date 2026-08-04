# Estado y bitácora del proyecto WMS

Última actualización: 2026-08-04

## Propósito

Este documento es la referencia ejecutiva y técnica del estado global del WMS. Se actualiza cuando cambia una capacidad, flujo operativo, integración, despliegue, migración, riesgo o decisión de producto.

No reemplaza:

- Git, que conserva el detalle exacto de cada cambio de código.
- `docs/builderbot-agent-map.md`, que define el contrato del agente.
- `docs/plan-pruebas-siigo.md`, que conserva evidencia detallada de Siigo.
- `docs/validacion-flujos-bodega-2026-08-04.md`, que documenta los smokes integrados.

## Resumen actual

### 2026-08-04 - Cierre de produccion con metadatos completos

- El parser separa motivo de merma, ubicacion y fecha de vencimiento en una sola frase.
- El cierre acepta alias del LLM para vencimiento, valida la fecha y la guarda en lote y stock.
- Las respuestas de cierre y ajustes de materiales muestran el codigo visible de ubicacion, no el ID interno.
- El reintento de un cierre informa responsable y fecha/hora sin repetir movimientos.
- Se corrigieron de forma auditada los metadatos QA de `OP-20260804-000060` sin modificar cantidades.
- Prompt sincronizado por MCP en Entrada y Voz; hash verificado `f3888f9f...f501f90`.
- Validacion local: 17 pruebas aprobadas.

### 2026-08-04 - Notificaciones salientes habilitadas por defecto

- Se restauro el comportamiento historico de mensajeria proactiva sin exigir `ENABLE_WORKFLOW_NOTIFICATIONS`.
- `DISABLE_OUTBOUND_NOTIFICATIONS=true` se conserva como corte de emergencia para envios y reintentos.
- Se mantuvieron la seleccion de destinatarios por rol, la deduplicacion por evento y destinatario, y la bitacora en `notificaciones_salida`.
- Validacion local: 15 pruebas aprobadas y build Vite aprobado.

### 2026-08-04 - Preparacion de pruebas E2E por rol

- Se creo `docs/plan-pruebas-e2e-wms.md` con el recorrido completo WhatsApp, API, MySQL, dashboard y Siigo sandbox.
- Se agrego `scripts/qa/e2e-preflight.js`, verificador de solo lectura para lineas, roles, ubicaciones, BOM, FEFO, stock e invariantes.
- Se confirmo que las dos lineas humanas estan activas y que la linea del agente no pertenece a un usuario operativo.
- Se corrigio el endpoint directo de despacho para respetar `ALLOW_DIRECT_DISPATCH_REQUEST=false` y exigir una tarea originada en factura Siigo.
- Validacion local: 13 pruebas aprobadas, build Vite aprobado y preflight MySQL sin bloqueos.
- Desplegado en `8042f45`: 20/20 rutas del dashboard y webhook operativo revalidados en Vercel.

| Área | Estado | Fuente de verdad |
| --- | --- | --- |
| Dashboard React | Desplegado y operativo | `frontend/src`, Vercel |
| API principal | Serverless activa | `api/v1`, Vercel |
| Backend Express | Histórico, no es producción | `backend/src` |
| MySQL | Conectado y con migraciones 07-10 aplicadas | `api/_lib/db.js`, `database` |
| Agente WhatsApp | Texto y voz configurados en BBC | `docs/Prompt WMS.txt`, BBC |
| Producción | Camino completo validado | Servicios `production-*` y smoke QA |
| Recepción | OC, factura, conciliación y distribución validadas | Servicios de recepción y smoke QA |
| Despacho | Factura Siigo, reserva y confirmación validadas | `dispatch-workflow.js` y smoke QA |
| Siigo | Sandbox validado; polling de compras y ventas programado en Vercel | `api/_lib/siigo.*`, crons Vercel |
| Notificaciones WhatsApp | Implementadas e idempotentes; activación controlada | `builderbot-notifications.js` |
| Roles nuevos | Implementados; asignación real pendiente | `capabilities.js`, dashboard Usuarios |
| Seguridad | Auditoría aplicada; quedan riesgos residuales documentados | Validación del 2026-08-04 |

## Estado desplegado comprobado

Comprobación del 2026-08-04:

- URL: `https://wms-seven-ebon.vercel.app`.
- `GET /api/v1/health`: HTTP 200 y `status=ok`.
- MySQL: conectado.
- Tablas críticas verificadas: `lots`, `kardex`, `stock`, `productos`, `recepciones`, `despachos`, `mermas`, `aprobaciones`, `ordenes_produccion` y `bom`.
- Rama principal: `main`.
- Repositorio: `https://github.com/royandi200/WMS`.
- Último commit funcional versionado: `21a0dfc`.

La salud HTTP no sustituye una prueba funcional por rol. El siguiente control pendiente es ejecutar el recorrido WhatsApp/dashboard con los números temporales asignados a Sofi, Nelly, Alistador y Anderson.

## Arquitectura vigente

```text
Dashboard React/Vite -----> API serverless Vercel -----> MySQL
       |                           |                       |
       |                           +-----> Siigo API       |
       |                           +-----> BuilderBot API --+--> WhatsApp
       |                                                   |
WhatsApp -> BuilderBot + LLM -> webhook WMS ---------------+
```

Reglas arquitectónicas:

1. `api/v1` es el backend de producción.
2. Dashboard y WhatsApp deben reutilizar los mismos servicios de dominio de `api/_lib`.
3. El rol se vuelve a consultar en MySQL; no se confía en el JSON del LLM.
4. Las mutaciones críticas usan transacciones, bloqueos e idempotencia.
5. Siigo origina los documentos contables; el WMS controla ejecución física, reservas, lotes y trazabilidad.

## Capacidades operativas actuales

### Recepción

- Carga estructurada de órdenes de compra de proveedor desde dashboard.
- Importación de factura de compra Siigo como recepción pendiente.
- Conciliación OC versus factura versus conteo físico.
- Distribución por lote, ubicación, vencimiento y condición.
- Condiciones: `DISPONIBLE`, `CUARENTENA`, `RECHAZADO` y `PENDIENTE_DISPOSICION`.
- Solo `DISPONIBLE` suma stock utilizable.
- Nelly puede confirmar su propia recepción.
- Recepciones manuales libres están desactivadas por defecto.

### Producción

- Sofi/Admin libera OP para `OC_CLIENTE` o `STOCK_SEGURIDAD`.
- Reserva de BOM por FEFO, lote y ubicación.
- Exclusión de lotes vencidos, no disponibles o en ubicaciones inactivas.
- Alistador confirma materiales e inicia producción.
- Registro de entrega adicional y devolución de materia prima con lote y ubicación.
- Nelly cierra la OP con conformes, merma, motivo y ubicación de producto terminado.
- Conciliación entre consumo teórico y real.
- Repetir confirmación o cierre no duplica movimientos.
- División de línea permanece implementable pero desactivada.

### Ventas y despacho

- La factura de venta se crea primero en Siigo.
- El polling importa la factura, el cliente final y sus líneas.
- El WMS crea una tarea y reserva stock por FEFO.
- Anderson confirma la salida física.
- El inventario se descuenta únicamente al confirmar el despacho.
- La trazabilidad enlaza lote, factura y cliente final.
- Despachos libres sin factura y despachos parciales están desactivados.

### Inventario y calidad

- Stock por SKU, lote, bodega y ubicación.
- Búsqueda profesional de producto con detalle de lotes.
- Consulta de lote y trazabilidad extendida.
- Stock bajo, resumen, kardex y mapa de bodega.
- Mermas durante proceso y cierre de producción.
- Devoluciones desde dashboard e historial.
- Cuarentena, rechazo y destrucción no regresan automáticamente a disponible.

### Usuarios y permisos

Roles objetivo:

| Rol | Responsable inicial | Alcance |
| --- | --- | --- |
| `admin` | Sofi | Administración y coordinación de producción |
| `recepcion_cierre` | Nelly | Recepción, clasificación, ubicación y cierre de producción |
| `alistador` | Por asignar | BOM, FEFO, picking, inicio y materiales de producción |
| `despacho` | Anderson | Tareas Siigo y confirmación de salida |
| `consulta` | Opcional | Lectura sin mutaciones |

Los permisos se centralizan en `api/_lib/capabilities.js`. El dashboard permite asignar roles existentes; el editor de permisos arbitrarios se pospuso intencionalmente.

Los roles heredados `supervisor`, `operario` y `validador` siguen disponibles por compatibilidad y deben retirarse gradualmente.

## Integraciones

### BuilderBot Cloud

- Proyecto: `Bodega Inventarios`.
- Project ID: `5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d`.
- Entrada de texto: prompt remoto sincronizado con `docs/Prompt WMS.txt`.
- Entrada de voz: clasificador creado el 2026-08-04 con el mismo prompt.
- Ambos flujos entregan JSON con `kw=g0m@s` al flujo `Salida`.
- Salida llama `POST /api/v1/webhook/builderbot` y mapea `{mensaje}`.
- SHA-256 del prompt sincronizado el 2026-08-04: `f63681366699d8aefe3c4cfa1476d48e8432453758960247e3488425f4cb9c2c`.

El validador BBC marca `Entrada` como dead end por una limitación legacy de conteo. La API Manager confirma que la respuesta existe y está activa.

### Siigo

- Autenticación con usuario API y access key; token cacheado en `siigo_config`.
- Catálogo y terceros sincronizables.
- Compras y ventas importadas mediante polling incremental.
- Crons de Vercel cada dos minutos, alternados para compras y ventas.
- Webhooks implementados, pero su suscripción debe manejarse con cautela en el sandbox compartido.
- Las pruebas confirmaron documentos de compra y venta visibles en Siigo Nube.
- Cotizaciones con validación de stock fueron probadas, pero no son el flujo comercial principal acordado.
- La API de Siigo probada no expuso un flujo utilizable de órdenes de compra; queda pendiente de definición con el cliente.

### MySQL

- Fuente de verdad operativa del WMS.
- Acceso de aplicación mediante `mysql2/promise`.
- Conexión serverless reutilizable para consultas y conexión dedicada para transacciones.
- MCP local de solo lectura disponible para diagnóstico asistido.
- Migraciones 07-10 agregan roles, flujos de bodega, notificaciones y conciliación de recepción.

### SysCafé

Existe una integración en el backend Express histórico. No está expuesta por la API serverless vigente ni forma parte del flujo productivo actual. No debe presentarse como integración activa.

## Banderas operativas

Valores seguros recomendados mientras se completan las pruebas:

```text
ALLOW_PARTIAL_DISPATCH=false
ENABLE_BACKORDER_ALERTS=false
AUTO_RELEASE_STALE_RESERVATIONS=false
RESERVE_AVAILABLE_ON_SHORTAGE=true
REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT=true
ALLOW_SPLIT_PRODUCTION_LINE=false
ALLOW_DIRECT_DISPATCH_REQUEST=false
ALLOW_MANUAL_RECEPTION=false
ENABLE_WORKFLOW_NOTIFICATIONS=false
```

Las notificaciones solo deben habilitarse después de asignar y comprobar los teléfonos de los cuatro roles.

## Validación acumulada

- `npm test`: 12 subpruebas aprobadas tras el ajuste del prompt.
- `npm run build`: build de producción aprobado en la última entrega funcional.
- Smokes integrados de producción, recepción y despacho aprobados.
- Idempotencia comprobada en cierre de OP, recepción y despacho.
- FEFO corregido para excluir vencidos.
- Cuarentena y rechazo comprobados sin stock disponible.
- Descuento de despacho comprobado una sola vez.
- Auditoría `wms-security-audit` ejecutada sobre la entrega del 2026-08-04.

## Riesgos y pendientes prioritarios

1. Configurar `X-BuilderBot-Secret` en BBC y retirar el fallback de autenticación por `kw` antes de usar datos productivos.
2. Asignar los usuarios reales o temporales a los cuatro roles y ejecutar pruebas WhatsApp por etapas.
3. Mantener desactivadas las notificaciones hasta validar destinatarios y evitar duplicados.
4. Definir múltiples facturas o recepciones parciales contra una misma OC.
5. Completar el ciclo de reservas para despachos parciales antes de habilitarlo.
6. Instalar o verificar la CA de MySQL; la opción TLS actual puede usar `rejectUnauthorized=false`.
7. Confirmar con el cliente el uso real de órdenes de compra en Siigo.
8. Separar y depurar datos QA antes de producción; los SKU del cliente son reales, pero BOM y movimientos de prueba no lo son necesariamente.
9. Actualizar o reemplazar `README.md`, `docs/architecture.md` y `docs/siigo-integration.md`, que describen componentes históricos.
10. Reducir la respuesta pública de `/api/v1/health`: actualmente expone nombres, conteos de columnas e identificadores recientes que no son necesarios para monitoreo externo.

## Cronología consolidada

### 2026-04: base del sistema

- Se construyeron frontend, esquema MySQL, backend Express y API serverless.
- Se consolidó Vercel como runtime principal.
- Se añadieron autenticación JWT, inventario, producción, recepción, despacho, mermas, aprobaciones, dashboard y webhook BuilderBot.
- Se corrigieron múltiples diferencias entre modelos iniciales y el esquema MySQL real.

### 2026-05 a 2026-06: integraciones y seguridad

- Se añadió SysCafé al backend histórico.
- Se corrigieron consultas MySQL del dashboard.
- Se ejecutó una auditoría de seguridad y se corrigieron hallazgos prioritarios.
- Se corrigieron rutas de búsqueda de inventario.

### 2026-07: catálogo, agente y Siigo

- Se cargó el catálogo Infinity con SKU reales del cliente.
- Se añadieron fixtures controlados para pruebas del agente.
- Se estabilizaron aprobaciones, cierres con merma, trazabilidad, lotes y dashboard.
- Se añadió creación de devoluciones desde dashboard.
- Se implementaron autenticación, sincronización, polling, webhooks y reconciliación de Siigo.
- Se validaron flujos Siigo-first para compras y ventas, además de cotizaciones con reserva.

### 2026-08-04: flujo operativo por roles

- Se implementaron roles y capacidades centralizadas.
- Se añadió OC de proveedor, conciliación y distribución física de recepción.
- Se implementó liberación de OP, BOM/FEFO, confirmación del alistador, ajustes de MP y cierre por Nelly.
- Se implementó factura Siigo como origen de despacho y confirmación física por Anderson.
- Se añadieron notificaciones salientes idempotentes e historial de reintentos.
- Se ejecutaron smokes completos e invariantes de base de datos.
- Se sincronizó el prompt del WMS en BBC.
- Se creó el clasificador faltante para notas de voz.

## Regla de mantenimiento

Al cerrar una entrega:

1. Actualizar la fecha y el resumen de estado.
2. Agregar el cambio a la cronología.
3. Actualizar capacidades, banderas, integraciones y riesgos afectados.
4. Registrar evidencia de pruebas y despliegue.
5. No incluir contraseñas, tokens, teléfonos completos ni datos del sandbox de terceros.
