# Plan maestro de flujos de bodega

## Objetivo

Implementar un flujo operativo trazable desde la compra o demanda hasta el cliente final:

`OC proveedor -> factura de compra Siigo -> recepcion fisica -> inventario/lotes -> produccion -> factura de venta Siigo -> despacho WMS -> cliente final`.

El plan prioriza una demostracion funcional temprana y deja las decisiones pendientes detras de configuraciones reversibles.

## Estado al 2026-08-04

- Completado: contratos, capacidades, roles versionados y asignacion de roles desde dashboard.
- Completado: OC de proveedor estructurada, conciliacion OC-factura-fisico y clasificacion por lote/ubicacion/condicion.
- Completado: liberacion de OP, reserva FEFO vigente, confirmacion del Alistador, ajustes de MP y cierre por Nelly.
- Completado: factura Siigo como origen de despacho, reserva trazable y confirmacion fisica idempotente.
- Completado: notificaciones salientes idempotentes, historial y reintento de errores.
- Completado: contrato nuevo de BuilderBot y bloqueo por defecto de recepcion/despacho libres heredados.
- Validado: pruebas unitarias, build, invariantes de MySQL y smoke completo con `00102-PTASH60`.
- Completado: prompt de Entrada sincronizado en BuilderBot con `docs/Prompt WMS.txt`.
- Completado: clasificador de Voz creado con el mismo prompt y redireccion al flujo Salida.
- Comprobado: despliegue Vercel y `GET /api/v1/health` en estado `ok`, con MySQL conectado.
- Pendiente antes de demo: asignar usuarios reales o temporales a `admin`, `recepcion_cierre`, `alistador` y `despacho`.
- Pendiente antes de demo: ejecutar la matriz HTTP/WhatsApp por rol y validar destinatarios antes de habilitar notificaciones.
- Pendiente de producto: recepciones parciales de una misma OC y ejecucion completa de despachos parciales.

## Decisiones confirmadas

- Sofi tendra el rol `ADMIN` y tambien coordinara la produccion.
- Nelly confirmara sus propias recepciones y cerrara produccion.
- Inicialmente habra un solo Alistador por orden de produccion.
- Anderson sera responsable del alistamiento y confirmacion de despachos.
- Las ventas y facturas de venta se crean exclusivamente en Siigo.
- El WMS no creara remisiones en Siigo; generara comprobantes internos de despacho.
- Todo despacho debe conservar el cliente final de la factura Siigo.
- La estructura para despacho parcial se conserva, pero su ejecucion completa permanece pendiente y desactivada.
- Alertas, vencimientos y liberaciones automaticas quedaran desactivados hasta aprobacion.

## Decisiones reversibles iniciales

- `ALLOW_PARTIAL_DISPATCH=false`: prohibe despachos parciales en UI y API.
- `ENABLE_BACKORDER_ALERTS=false`: no genera escalaciones automaticas.
- `AUTO_RELEASE_STALE_RESERVATIONS=false`: ninguna reserva se libera automaticamente.
- `RESERVE_AVAILABLE_ON_SHORTAGE=true`: si una factura no tiene stock completo, reserva lo disponible y deja el faltante como backorder, sin habilitar despacho.
- `ALLOW_DIRECT_DISPATCH_REQUEST=false`: evita crear despachos sin factura Siigo.
- `ALLOW_MANUAL_RECEPTION=false`: evita entradas que omitan OC y factura Siigo.
- `DISABLE_OUTBOUND_NOTIFICATIONS=true`: corte de emergencia reversible para detener mensajes salientes.
- No se cancela ni modifica automaticamente ningun documento contable de Siigo.
- Una factura con cliente ausente queda en `PENDIENTE_DATOS_CLIENTE` y no genera tarea de despacho.

## Modelo de roles y capacidades

### Alcance inicial

| Rol | Responsable inicial | Capacidades principales |
| --- | --- | --- |
| `ADMIN` | Sofi | Usuarios, produccion, excepciones, ajustes y segundas verificaciones |
| `RECEPCION_CIERRE` | Nelly | Confirmar recepciones, clasificar/ubicar MP y cerrar produccion |
| `ALISTADOR` | Por asignar | Consultar BOM/FEFO, confirmar picking e iniciar produccion |
| `DESPACHO` | Anderson | Consultar tareas, confirmar lotes y ejecutar despachos completos |
| `CONSULTA` | Opcional | Consultas y reportes sin mutaciones |

### Implementacion pragmatica

1. Crear claves de capacidad estables, por ejemplo `production.release`, `reception.confirm` y `dispatch.confirm`.
2. Centralizar autorizacion en `requireCapability()`; eliminar comprobaciones dispersas por nombre de rol.
3. Mantener inicialmente el mapa rol-capacidades en una unica configuracion versionada.
4. Permitir desde dashboard asignar un rol existente a cada usuario.
5. Posponer el editor de permisos. Si luego se necesita, migrar el mismo mapa a `permissions` y `role_permissions` sin cambiar handlers.

## Fase 0: contratos, estados y protecciones

### Trabajo

- Definir estados y transiciones validas de recepcion, produccion y despacho.
- Crear capacidades y guardas centrales.
- Corregir las diferencias actuales entre permisos de WhatsApp y dashboard.
- Unificar la ejecucion de aprobaciones para que ambos canales llamen al mismo servicio.
- Agregar idempotencia, bloqueo transaccional y auditoria de canal, rol y resultado.
- Limpiar o clasificar las solicitudes antiguas antes de activar los nuevos flujos.

### Criterio de salida

Una misma operacion produce el mismo resultado desde dashboard o WhatsApp y no puede ejecutarse dos veces.

## Fase 1: ordenes de compra y recepcion

Se distinguiran dos conceptos:

- `OC_PROVEEDOR`: compra de materia prima que se coteja contra factura de compra y recepcion fisica.
- `OC_CLIENTE`: demanda que puede originar una orden de produccion.

### Carga de OC proveedor

- Registrar encabezado, proveedor, numero, fecha y lineas esperadas.
- Adjuntar el documento original y conservar metadatos.
- Para la primera version, usar captura estructurada o plantilla de importacion; OCR automatico queda fuera del camino critico.
- Vincular posteriormente la factura de compra importada desde Siigo.

### Cotejo de tres fuentes

Por cada linea se conservara:

- Cantidad ordenada en la OC.
- Cantidad facturada en Siigo.
- Cantidad recibida fisicamente.
- Diferencias de SKU, cantidad, lote, vencimiento y estado.

### Confirmacion de Nelly

Nelly podra dividir una linea recibida entre:

- `DISPONIBLE`: existencia fisica y disponible.
- `CUARENTENA`: existencia fisica, pero no disponible.
- `RECHAZADA` o `PENDIENTE_DISPOSICION`: no disponible; conserva custodia y evidencia hasta su disposicion.

Cada division tendra lote, cantidad, ubicacion, motivo y responsable. Una misma linea podra distribuirse en varias ubicaciones.

### Captura asistida por el agente

La automatizacion de recepcion se implementara en dos fases para separar rapidez de efecto contable:

1. Nelly dicta o escribe cantidades, lotes, vencimientos, condiciones, ubicaciones y motivos.
2. El agente genera un borrador estructurado asociado a una recepcion pendiente; esta accion no crea stock, lotes ni movimientos.
3. La API valida suma fisica, OC, factura, SKU, lotes unicos, ubicaciones de la bodega, condiciones y diferencias.
4. El agente devuelve un resumen de impacto: disponible, cuarentena, rechazado y diferencias contra OC/factura.
5. Nelly corrige el borrador o confirma explicitamente la version exacta. Cualquier cambio invalida la confirmacion anterior.
6. Al confirmar, la API bloquea la recepcion, repite las validaciones dentro de una transaccion y ejecuta una sola vez mediante clave idempotente.

Para la primera version, WhatsApp prepara el borrador y el dashboard conserva el boton final `Aprobar recepcion fisica`. La confirmacion completa por WhatsApp se habilitara despues de probar expiracion del borrador, hash del contenido, reintentos y doble confirmacion cuando existan diferencias.

### Criterio de salida

El sistema explica todas las diferencias entre OC, factura Siigo y recepcion fisica, y ninguna cantidad en cuarentena o disposicion aparece como disponible.

## Fase 2: planeacion, alistamiento y consumo de produccion

### Creacion de OP por Sofi

Toda OP indicara:

- Producto y cantidad planeada.
- Origen `OC_CLIENTE` o `STOCK_SEGURIDAD`.
- Cliente y referencia de OC cuando sea por demanda.
- Responsable de alistamiento.

Sofi crea y libera la OP; no requiere aprobar una solicitud creada por ella misma.

### Asignacion al Alistador

- Calcular BOM.
- Reservar por FEFO.
- Asignar lote y ubicacion por insumo.
- Crear una tarea unica de alistamiento.
- Notificar por dashboard y WhatsApp.

El Alistador confirma cantidades, lotes y ubicaciones realmente recogidos. Esa confirmacion descuenta la ubicacion de bodega, registra movimiento a WIP y cambia la OP a `EN_PROCESO`.

### Consumos adicionales y devoluciones

Registrar durante la OP:

- Entregas adicionales con insumo, lote, ubicacion, cantidad, motivo y responsable.
- Sustituciones del FEFO sugerido como excepcion auditable.
- Devoluciones de material no consumido a lote y ubicacion.

Calculos de cierre:

`consumo_real = entrega_inicial + entregas_adicionales - devoluciones`.

`variacion = consumo_real - consumo_teorico_segun_BOM`.

### Criterio de salida

Para cada insumo se puede explicar cuanto se planeo, reservo, retiro, agrego, devolvio y consumio, incluyendo lote y ubicacion.

## Fase 3: cierre de produccion

Nelly confirmara:

- Unidades conformes.
- No conformes y merma.
- Motivos.
- Material devuelto.
- Lote y ubicacion del producto terminado.

El sistema mostrara antes de confirmar:

- Plan inicial contra resultado.
- Consumo teorico contra consumo real por insumo.
- Variaciones y entregas adicionales.
- Balance de materiales.

Las desviaciones configuradas como destructivas requeriran segunda verificacion de Sofi. Los umbrales quedaran configurables y desactivados inicialmente.

### Criterio de salida

El cierre crea el lote terminado, registra mermas y devoluciones y cierra la OP en una sola transaccion.

## Fase 4: facturas Siigo y despachos WMS

### Importacion

- Mantener polling idempotente de facturas de venta.
- Importar cliente final, lineas, cantidades e identificadores Siigo.
- Cancelaciones o notas credito previas al despacho cancelan tareas y liberan reservas.

### Reserva y tarea

- Intentar reserva completa por FEFO y ubicacion.
- Si falta stock, estado `BLOQUEADA_POR_STOCK`; reservar lo disponible y registrar el resto como `BACKORDER`.
- Con stock completo, crear tarea para Anderson con cliente, factura, productos, lotes, cantidades y ubicaciones.

### Confirmacion

Anderson confirma los lotes y cantidades fisicas. Solo entonces:

- Se descuenta inventario.
- Se consumen reservas.
- Se crea el comprobante de despacho WMS.
- Se registra kardex y trazabilidad hacia cliente final.

### Capacidad parcial desactivada

El modelo permitira varios comprobantes por factura y control acumulado por linea, pero UI y API lo bloquearan mientras `ALLOW_PARTIAL_DISPATCH=false`.

### Criterio de salida

No se puede superar lo facturado, repetir una salida ni despachar sin cliente final. Cada lote despachado queda vinculado a factura y cliente.

## Fase 5: experiencia, tareas y notificaciones

La fuente de verdad para eventos, destinatarios, contenido, fallbacks e idempotencia es `docs/politica-notificaciones-operativas.md`.

- Inicio por rol con tareas pendientes y excepciones relevantes.
- Bandejas para Nelly, Alistador, Anderson y Sofi.
- Acciones con datos precargados; evitar solicitar IDs internos al usuario.
- Notificaciones WhatsApp como aviso, no como unica fuente de trabajo.
- Registrar aceptacion/fallo de notificaciones y permitir reintento.
- Mostrar trazabilidad completa desde proveedor hasta cliente final.

## Fase 6: pruebas, datos y despliegue

### Pruebas obligatorias

- Matriz de capacidades por rol y canal.
- Idempotencia y concurrencia de aprobaciones y movimientos.
- OC/factura/recepcion con coincidencia y diferencias.
- Disponible, cuarentena y disposicion.
- Produccion normal, consumo adicional, devolucion y merma.
- Factura con stock completo, insuficiente, cancelada y con nota credito.
- Despacho por multiples lotes y ubicaciones.
- Trazabilidad proveedor -> MP -> OP -> PT -> factura -> cliente.

### Despliegue

- Migraciones idempotentes y respaldo previo.
- Datos demo separados y claramente identificados.
- Activacion por flags.
- Smoke tests en Vercel y BuilderBot.
- Prueba guiada con cada responsable antes del uso operativo.

## Estrategia para optimizar el tiempo

### Entrega demostrable

Priorizar un camino completo y visible:

1. Roles y tareas basicas.
2. OC proveedor -> factura -> recepcion y ubicacion.
3. OP por Sofi -> alistamiento -> inicio -> cierre por Nelly.
4. Factura Siigo -> tarea Anderson -> despacho -> trazabilidad.

Se posponen del demo inicial:

- OCR automatico de documentos.
- Editor visual de permisos.
- Multiples alistadores.
- Despachos parciales activos.
- Alertas y vencimientos automaticos.
- Reglas avanzadas configurables por cliente.

### Paralelizacion

- Frente A: esquema, servicios, estados, transacciones e idempotencia.
- Frente B: dashboard por roles y tareas.
- Frente C: contratos BuilderBot, notificaciones y pruebas integradas.

Los frentes B y C comienzan cuando los contratos del frente A queden fijados, sin esperar a que termine toda la logica.

## Estimacion

Estimacion para ejecucion intensiva asistida por IA, con acceso continuo al repositorio, base de datos y ambiente de pruebas:

| Entrega | Trabajo efectivo estimado | Tiempo calendario probable |
| --- | --- | --- |
| Esqueleto tecnico y camino feliz demostrable | 6 a 10 horas | Dentro de 1 jornada intensiva |
| Demo integrada con migraciones, despliegue y smoke tests | 12 a 20 horas | 1 a 2 dias |
| Implementacion operativa completa de este plan | 24 a 40 horas | 3 a 5 dias |
| Endurecimiento, concurrencia y estabilizacion con usuarios | 8 a 16 horas adicionales | 1 a 2 dias adicionales |

La diferencia entre trabajo efectivo y calendario depende de esperas externas: despliegues, comportamiento real de Siigo, formato de las OC y validaciones de usuarios. Para proteger la fecha de demostracion, se usara inicialmente una carga estructurada y documentos controlados.

### Distribucion del trabajo efectivo

- Fundacion de estados, capacidades, migraciones y servicios compartidos: 4 a 6 horas.
- OC, cotejo documental, recepcion, clasificacion y ubicaciones: 4 a 7 horas.
- Produccion, BOM/FEFO, alistamiento, consumos adicionales y cierre: 6 a 9 horas.
- Facturas, reservas, tareas de despacho y trazabilidad a cliente: 5 a 8 horas.
- Dashboard, WhatsApp, pruebas integradas y despliegue: 5 a 10 horas.

Las fases se solapan: el camino feliz de demostracion puede completarse antes de terminar todas las variantes, controles y pruebas de excepcion.

## Hitos de control

- Hito 1: contratos, roles y estados aprobados.
- Hito 2: recepcion completa demostrable.
- Hito 3: produccion completa demostrable.
- Hito 4: despacho y trazabilidad completa demostrables.
- Hito 5: pruebas integradas, despliegue y guion de presentacion.
