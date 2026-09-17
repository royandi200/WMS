# Inventario detallado de la plataforma WMS

Base para el plan de pruebas integral

Fecha: 16 de septiembre de 2026. Revisión con el cliente: 17 de septiembre de 2026.
Fuente: código del repositorio `royandi200/WMS` (rama `main`): pantallas `frontend/src/pages`, funciones `api/v1`, webhook `api/v1/webhook/builderbot.js`, notificaciones `api/_lib/builderbot-notifications.js`, integración `api/_lib/siigo.*`.

## Cómo leer este documento

La plataforma tiene 3 componentes:

- **A. Panel web WMS** (pantallas + API).
- **B. Agente WhatsApp** (BuilderBot → webhook WMS) y **mensajes automáticos** (WMS → API BuilderBot).
- **C. Integración SIIGO** (WMS ↔ API SIIGO).

Cada función tiene un ID único para referenciarla en el plan de pruebas.

Tipos de operación:

- **C** = Crear / registrar
- **R** = Consultar / listar / ver detalle
- **U** = Editar / actualizar
- **D** = Eliminar / anular / cancelar / descartar
- **P** = Proceso (confirma, aprueba, mueve inventario o cambia estado)
- **E** = Exportar / descargar / imprimir

Columna "Mueve inventario": indica si la función modifica stock, reservas o lotes. Son las de mayor prioridad de prueba.

## Marcas de vigencia (revisión del 17 de septiembre de 2026)

| Marca | Significado |
|---|---|
| (sin marca) | Función vigente. Entra en la batería de pruebas. |
| **[FUERA]** | Flujo anterior o retirado. No se prueba y debe eliminarse de la herramienta. |
| **[CONDICIONAL]** | Depende de una bandera de configuración o del entorno. No se prueba en el entorno ordinario, pero no se elimina. |
| **[PENDIENTE DE RETIRO]** | El cliente decidió retirarla, pero sigue activa y visible en el código. Se prueba con criterio inverso: no debe estar disponible. |

Resumen de la depuración acordada:

| Grupo | IDs | Decisión |
|---|---|---|
| Circuito de aprobaciones | A2-06, A2-08, A11-01 a A11-04, B1-08, B4-01, B4-09, B5-07, B5-08, B6-11, E2E-06 | PENDIENTE DE RETIRO. La producción se libera y se cierra directamente. |
| Recepción manual / ingreso anterior | A3-16, B3-07 | FUERA. Se recibe contra OC operativa o maquila 3Q. |
| Solicitud directa de despacho | A4-06, B5-03 | FUERA. El despacho de cliente nace de SIIGO; la salida a 3Q se confirma en Despachos. |
| Crear facturas desde el WMS | C6-03, C6-04 | FUERA. Las facturas nacen en SIIGO. |
| Envío a DIAN | C6-05 | FUERA mientras `SIIGO_STAMP_SEND=false`. |
| Crear y eliminar usuarios | A13-03, A13-04 | FUERA. No existen en la API ni en la pantalla. |
| Depuración, migraciones y suscripción de webhooks | A17-03, A17-04, C7-05 | CONDICIONAL. No son flujos retirados. |

Verificación de la depuración (casos nuevos):

| ID | Caso | Resultado esperado |
|---|---|---|
| DEP-01 | Buscar "Aprobaciones" en menú lateral, menú inferior y dashboard | No debe aparecer. **Hoy falla:** sigue visible. |
| DEP-02 | Llamar las funciones de aprobaciones con sesión válida | Deben responder "no disponible". **Hoy falla:** responden y ejecutan la acción. |
| DEP-03 | Enviar por WhatsApp "solicitar inicio de producción" y "solicitar cierre" | Deben indicar que se libera o se cierra directamente. **Hoy falla:** crean solicitud pendiente. |
| DEP-04 | Enviar "apruebo CÓDIGO" / "rechazo CÓDIGO" | No debe existir la acción. **Hoy falla:** se ejecuta y puede mover inventario. |
| DEP-05 | Solicitar despacho directo y recepción manual | Deben quedar rechazados por bandera en `false` |
| DEP-06 | Enviar por WhatsApp el ingreso de recepción anterior | Debe redirigir al flujo por OC o maquila |
| DEP-07 | Confirmar que el WMS no crea facturas en SIIGO ni envía a DIAN | Sin documentos creados en SIIGO desde el WMS |

Riesgo abierto: mientras el circuito de aprobaciones siga activo, una solicitud enviada por WhatsApp queda esperando una aprobación que ya nadie atiende, y al aprobarse mueve inventario.

---

## 0. Roles y permisos

El acceso a cada pantalla y acción depende de capacidades asignadas por rol.

| Rol | Capacidades |
|---|---|
| admin | Todas |
| supervisor | Todas |
| validador | Solo lectura + ver y decidir aprobaciones |
| operario | Solo lectura + crear/confirmar recepciones, liberar/alistar/avanzar/cerrar producción, solicitar/confirmar despachos, devoluciones, mermas, consultar SIIGO |
| consulta | Solo lectura |
| recepcion_cierre | Solo lectura + crear/confirmar recepciones, cerrar producción, recibir maquila, mermas |
| alistador | Solo lectura + alistar y avanzar producción, mermas |
| despacho | Solo lectura + confirmar despachos, devoluciones, consultar SIIGO |

Solo lectura = dashboard, inventario, recepciones, producción, maquila, despachos, devoluciones, mermas, catálogo y SIIGO (lectura).

Capacidades existentes: `dashboard.view`, `inventory.read`, `inventory.adjust`, `reception.read`, `reception.create`, `reception.confirm`, `purchase_order.cancel`, `production.read`, `production.release`, `production.pick`, `production.advance`, `production.close`, `outsourcing.read`, `outsourcing.manage`, `outsourcing.receive`, `dispatch.read`, `dispatch.request`, `dispatch.confirm`, `returns.read`, `returns.manage`, `waste.read`, `waste.report`, `approvals.read`, `approvals.decide`, `catalog.read`, `catalog.manage`, `alert_settings.manage`, `siigo.read`, `siigo.poll`, `siigo.sync`, `webhook.logs.read`, `users.manage`.

Menú lateral y capacidad requerida:

| Grupo | Pantalla | Ruta | Capacidad |
|---|---|---|---|
| Principal | Dashboard | `/` | dashboard.view |
| Operación | Recepciones | `/recepciones` | reception.read |
| Operación | Despachos | `/despachos` | dispatch.read |
| Operación | Devoluciones | `/devoluciones` | returns.read |
| Operación | Inventario | `/inventario` | inventory.read |
| Operación | Producción | `/produccion` | production.read |
| Operación | Maquila 3Q | `/maquila` | outsourcing.read |
| Operación | Mermas | `/mermas` | waste.read |
| Control | Kardex | `/kardex` | inventory.read |
| Control | Aprobaciones | `/aprobaciones` | approvals.read |
| Catálogos | Productos | `/productos` | catalog.read |
| Administración | Usuarios | `/usuarios` | users.manage |
| Administración | Configurar alertas | `/configuracion-alertas` | alert_settings.manage (solo admin) |
| Administración | Notificaciones | `/notificaciones` | webhook.logs.read |
| Administración | Webhook Logs | `/webhook-logs` | webhook.logs.read |

---

# COMPONENTE A — Panel web WMS

## A1. Acceso (Login)

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A1-01 | Iniciar sesión | P | Correo y contraseña; mostrar/ocultar contraseña | `POST /auth/login` | No |
| A1-02 | Ver sesión actual | R | Datos del usuario, rol y capacidades | `GET /auth/me` | No |
| A1-03 | Renovar sesión | P | Refresh token al vencer el access token | `POST /auth/refresh` | No |
| A1-04 | Menú según permisos | R | Solo muestra pantallas con capacidad | — | No |
| A1-05 | Cerrar sesión | P | Salir del sistema | — | No |

## A2. Dashboard

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A2-01 | Actualizar indicadores | R | Botón "Actualizar" | `GET /dashboard`, `/inventory/summary`, `/inventory/low-stock` | No |
| A2-02 | Tarjeta Recepciones | R | Entrada y calidad: recibido vs rechazado | `GET /dashboard` | No |
| A2-03 | Tarjeta Almacén | R | Stock, reserva y riesgo: disponible vs reservado en lotes aptos | `GET /dashboard` | No |
| A2-04 | Tarjeta Producción | R | Órdenes en proceso vs cerradas | `GET /dashboard` | No |
| A2-05 | Tarjeta Mermas | R | Cantidad y órdenes afectadas | `GET /dashboard` | No |
| A2-06 | **[PENDIENTE DE RETIRO]** Tarjeta Aprobaciones | R | Bloqueos operativos: más antigua, producción | `GET /dashboard` | No |
| A2-07 | Excepciones que requieren atención | R | Lista con botón "Ver módulo" y acceso a "Kardex" | `GET /dashboard` | No |
| A2-08 | **[PENDIENTE DE RETIRO]** Aprobaciones por tipo | R | Con botón "Gestionar" | `GET /dashboard` | No |
| A2-09 | Actividad por módulo | R | Recepciones, despachos, inventario, aprobaciones | `GET /dashboard` | No |

## A3. Recepciones

Pestañas: **Órdenes de compra**, **Confirmar recepción**, **Histórico**.

### A3.1 Órdenes de compra

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A3-01 | Listar órdenes de compra | R | Estado: CARGADA, RECIBIDA_PARCIAL, CERRADA, CANCELADA | `GET /purchase-orders` | No |
| A3-02 | Crear orden de compra | C | Número de OC*, proveedor sincronizado*, fecha, PDF de la OC*, ítems (SKU, cantidad, unidad, precio); agregar y eliminar ítems | `POST /purchase-orders` | No |
| A3-03 | Descargar PDF de la OC | E | Botón "Descargar PDF" | `GET /purchase-orders?document_id=` | No |
| A3-04 | Cancelar orden de compra | D | Motivo de cancelación*; solo OC en CARGADA sin recepciones ni 3Q; requiere `purchase_order.cancel` | `PATCH /purchase-orders` | No |
| A3-05 | Listar borradores de OC leídos de PDF | R | Borradores creados desde WhatsApp | `GET /warehouse-documents?type=ORDEN_COMPRA` | No |
| A3-06 | Descargar PDF del borrador | E | Botón "Descargar" | `GET /warehouse-documents?file_id=` | No |
| A3-07 | Revisar borrador y convertir en OC | U/C | Botón "Revisar": corregir proveedor, SKU, cantidades, unidades, lote/vencimiento y crear la OC operativa | `POST /purchase-orders` | No |
| A3-08 | Descartar borrador de OC | D | Motivo* | `DELETE /warehouse-documents` | No |

### A3.2 Confirmar recepción

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A3-09 | Elegir origen de recepción | P | "Compra directa" o "Producto desde 3Q"; botón "Cambiar origen" | — | No |
| A3-10 | Preparar recepción desde OC | C | Selecciona OC*; carga saldo pendiente por SKU y ubicaciones sugeridas | `POST /reception` (PREPARAR_DESDE_OC) | No |
| A3-11 | Preparar recepción desde maquila 3Q | C | Orden de maquila 3Q*, cantidad de esta entrega* | `POST /reception` (PREPARAR_DESDE_MAQUILA) | No |
| A3-12 | Registrar distribución física | U | Por ítem: condición* (disponible/cuarentena/rechazo), cantidad física*, lote proveedor*, ubicación*, vencimiento*, motivo | — | No |
| A3-13 | Agregar otra ubicación o condición | U | Botón "Otra ubicación o condición"; eliminar distribución | — | No |
| A3-14 | Registrar diferencia | U | Motivo de la diferencia* cuando la cantidad no coincide | — | No |
| A3-15 | Confirmar recepción | P | Crea lotes, stock, kardex y novedades (faltante, dañado, sobrante); OC pasa a RECIBIDA_PARCIAL o CERRADA | `PUT /reception` | **Sí** |
| A3-16 | **[FUERA]** Crear recepción manual | C | Flujo anterior; bandera `ALLOW_MANUAL_RECEPTION=false` | `POST /reception` | **Sí** |

### A3.3 Histórico

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A3-17 | Consultar histórico de recepciones | R | Lista con filtros y detalle | `GET /reception` | No |

### A3.4 Recepciones In & Out (IO) y mixtas

El producto tiene una modalidad operativa: **PR** (producción interna), **PT** (maquila 3Q) e **IO** (In & Out, producto terminado que entra y sale sin transformación). La modalidad cambia el flujo y el prefijo del identificador.

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A3-18 | Identificador según modalidad | R | OC con productos solo IO → **IO ID**; el resto → **OC ID**; maquila → **MQ ID** | `GET /purchase-orders`, `GET /reception` | No |
| A3-19 | Recepción In & Out | P | OC con todos los ítems IO; entra directo a disponible sin producción | `POST/PUT /reception` | **Sí** |
| A3-20 | Recepción mixta | P | OC con ítems IO y no IO; se recibe en un solo acto conservando la distinción | `POST/PUT /reception` | **Sí** |
| A3-21 | Bloqueo por modalidad | P | Productos PR deben entrar por producción y PT por maquila 3Q; la recepción directa los rechaza | `POST /reception` | No |
| A3-22 | Confirmación con prefijo exacto | P | Un ID ambiguo exige el prefijo correcto (OC, IO o MQ); no se acepta el otro | webhook / `PUT /reception` | No |

## A4. Despachos

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A4-01 | Listar despachos | R | Pendientes/picking/completados/anulados, originados en factura SIIGO | `GET /dispatch` | No |
| A4-02 | Sincronizar facturas SIIGO | P | Fuerza importación de facturas de venta; crea despachos y reservas | `POST /siigo/import-invoices` | **Sí** (reserva) |
| A4-03 | Ver detalle del despacho | R | Ítems, lotes FEFO, ubicaciones, faltantes | `GET /dispatch` | No |
| A4-04 | Hoja imprimible del despacho | E | Botón "Abrir hoja imprimible" | — | No |
| A4-05 | Confirmar despacho físico | P | Descuenta stock y lote, libera reserva | `PUT /dispatch` | **Sí** |
| A4-06 | **[FUERA]** Solicitar despacho directo | C | Flujo anterior; bandera `ALLOW_DIRECT_DISPATCH_REQUEST=false` | `POST /dispatch` | **Sí** (reserva) |

## A5. Devoluciones

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A5-01 | Listar devoluciones | R | Historial | `GET /returns` | No |
| A5-02 | Registrar devolución | C | Factura o despacho origen*, referencia externa, SKU o ID*, cantidad*, estado* (Recuperable / Cuarentena), cliente origen, lote original despachado*, ubicación de reintegro*, observaciones | `POST /returns` | **Sí** |

## A6. Inventario

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A6-01 | Resumen de inventario | R | Disponible, reservado, bloqueado, total, en custodia 3Q, total bajo control | `GET /inventory/summary` | No |
| A6-02 | Consultar stock por producto | R | Buscar por SKU o ID; partidas por lote y ubicación | `GET /inventory/product/{id}` | No |
| A6-03 | Consultar lote (LPN) | R | Saldo de la partida, estado, vencimiento, ubicación actual | `GET /inventory/lot/{lpn}` | No |
| A6-04 | Stock bajo | R | Productos bajo umbral | `GET /inventory/low-stock` | No |
| A6-05 | Antigüedad de inventario | R | Aging por lote | `GET /inventory/aging` | No |
| A6-06 | Mapa de bodega | R | Vista de pájaro por zona y vista de estantes; seleccionar bodega | `GET /inventory/mapa` | No |
| A6-07 | Crear ubicación | C | Desde el mapa: nuevo pasillo, nivel o posición | `POST /inventory/ubicaciones` | No |
| A6-08 | Editar ubicación | U | Desde el mapa | `PUT /inventory/ubicaciones` | No |
| A6-09 | Eliminar ubicación | D | Desde el mapa (validar que no tenga stock) | `DELETE /inventory/ubicaciones?id=` | No |
| A6-10 | Listar ubicaciones | R | — | `GET /inventory/ubicaciones` | No |

## A7. Producción

Estados de orden: Planeada, Aprobada, En proceso, Cerrada, Cancelada.

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A7-01 | Listar órdenes de producción | R | Filtro por estado | `GET /production` | No |
| A7-02 | Ver detalle de orden | R | BOM, materiales, fases, lotes, mermas | `GET /production/{id}` | No |
| A7-03 | Crear / liberar orden de producción | C | ID del producto*, cantidad planificada*, destino*, referencia OC cliente*, cliente final*, notas; genera picking FEFO y notifica al alistador | `POST /production/start` | **Sí** (reserva) |
| A7-04 | Confirmar materiales (picking) | P | Orden*; confirma entrega de materiales; notifica inicio | `POST /production/confirm` | **Sí** |
| A7-05 | Ajustar materiales | U | Orden*, tipo*, SKU materia prima*, lote*, ubicación*, cantidad*, motivo | `POST /production/material-adjustment` | **Sí** |
| A7-06 | Preparar reposición de materiales | C | Orden en proceso*, unidades conformes faltantes*, motivo* | `POST /production/replenishment-prepare` | **Sí** (reserva) |
| A7-07 | Confirmar reposición | P | Reposición u orden* | `POST /production/replenishment-confirm` | **Sí** |
| A7-08 | Cancelar reposición | D | Libera reservas | `POST /production/replenishment-cancel` | **Sí** (libera) |
| A7-09 | Avanzar fase | U | OP ID*, fase destino* | `POST /production/advance` | No |
| A7-10 | Cerrar producción | P | OP ID*, unidades conformes*, merma/no conforme*, ubicación del producto terminado*, motivo de merma; crea lote terminado; notifica | `POST /production/close` | **Sí** |

## A8. Maquila 3Q

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A8-01 | Listar órdenes de maquila | R | Estado, remisiones, custodia | `GET /outsourcing` | No |
| A8-02 | Crear orden 3Q y preparar remisión | C | OC del producto esperado (opcional), maquilador*, SKU PT*, cantidad esperada*, notas; botón "Preparar remisión y picking" (reserva FEFO del BOM) | `POST /outsourcing` (CREATE) | **Sí** (reserva) |
| A8-03 | Crear orden 3Q desde documento | C | Desde borrador de salida 3Q leído de PDF | `POST /outsourcing` (CREATE_FROM_DOCUMENT) | **Sí** (reserva) |
| A8-04 | Vincular OC a orden 3Q | U | Remisión/orden 3Q sin OC*, OC con PDF*; botón "Validar y vincular OC" | `POST /outsourcing` (LINK_PURCHASE_ORDER) | No |
| A8-05 | Preparar remisión adicional | C | Orden 3Q*, SKU material*, cantidad adicional*, motivo* | `POST /outsourcing` (PREPARE_ADDITIONAL) | **Sí** (reserva) |
| A8-06 | Confirmar salida física a 3Q | P | Confirmación explícita; descuenta de ubicaciones y pasa a custodia 3Q | `POST /outsourcing` (CONFIRM_SHIPMENT) | **Sí** |
| A8-07 | Cancelar remisión | D | Libera reservas | `POST /outsourcing` (CANCEL_SHIPMENT) | **Sí** (libera) |
| A8-08 | Listar documentos leídos (salidas 3Q) | R | Borradores de PDF con cruce al catálogo y remisión WMS | `GET /warehouse-documents` | No |
| A8-09 | Descargar PDF del documento | E | — | `GET /warehouse-documents?file_id=` | No |
| A8-10 | Corregir datos extraídos | U | Destinatario, ciudad, dirección, NIT, teléfono, entrega, recibe, fecha, bultos, filas (agregar/eliminar), motivo de la corrección | `PATCH /warehouse-documents` | No |
| A8-11 | Descartar borrador de salida 3Q | D | Motivo | `DELETE /warehouse-documents` | No |
| A8-12 | Recepción de producto desde 3Q | P | Ver A3-11 y A3-15 | `POST/PUT /reception` | **Sí** |

## A9. Mermas

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A9-01 | Listar mermas | R | Historial | `GET /waste` | No |
| A9-02 | Registrar merma | C | Origen*, referencia externa, SKU*, cantidad*, lote*, ubicación*, orden de producción* (si aplica), motivo*; idempotente | `POST /waste` | **Sí** |

## A10. Kardex

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A10-01 | Consultar kardex | R | Buscar por SKU/lote; paginación "Siguiente" | `GET /inventory/kardex` | No |

## A11. Aprobaciones — [PENDIENTE DE RETIRO]

El cliente retiró este circuito, pero sigue activo y visible: pantalla `/aprobaciones`, entrada en el menú lateral y en el menú inferior del celular, dos tarjetas en el dashboard y funciones que al aprobar ejecutan la acción. Probar con los casos DEP-01 a DEP-04.

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A11-01 | Listar pendientes | R | Solicitudes en espera | `GET /approvals` | No |
| A11-02 | Ver historial | R | Aprobadas y rechazadas | `GET /approvals` | No |
| A11-03 | Aprobar solicitud | P | Ejecuta la acción aprobada (inicio/cierre producción, despacho) | `POST /approvals/approve` | **Sí** (según acción) |
| A11-04 | Rechazar solicitud | P | Motivo de rechazo (opcional) | `POST /approvals/reject` | No |

## A12. Productos

Pestañas: **Catálogo**, **Nuevo producto / Editar producto**.

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A12-01 | Listar catálogo | R | Buscar por SKU/nombre; botón actualizar | `GET /products` | No |
| A12-02 | Ver detalle de producto | R | Disponible, cuarentena, reservado, total físico, lotes activos, próximo vencimiento, último movimiento, semáforo, descripción, SIIGO ID, SIIGO Code, SIIGO activo, última sincronización, unidad, stock mínimo y máximo | `GET /products/{id}` | No |
| A12-03 | Crear producto | C | SKU*, unidad*, nombre*, tipo* (producto terminado, materia prima, empaque, insumo, otro), descripción | `POST /products` | No |
| A12-04 | Editar producto | U | Mismos campos | `PUT /products/{id}` | No |
| A12-05 | Activar / desactivar producto | U | Toggle | `PATCH /products/{id}/toggle` | No |

## A13. Usuarios

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A13-01 | Listar usuarios | R | Nombre, correo, teléfono, rol | `GET /users` | No |
| A13-02 | Cambiar rol de usuario | U | Selección de rol | `PUT /users` | No |
| A13-03 | **[FUERA]** Crear usuario | C | Existe en el cliente del navegador, pero la API solo acepta consultar y editar | — | No |
| A13-04 | **[FUERA]** Eliminar usuario | D | Igual que el anterior; debe eliminarse del cliente | — | No |

## A14. Configurar alertas (solo admin)

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A14-01 | Listar umbrales por producto | R | Buscar por código o nombre | `GET /inventory/alert-settings` | No |
| A14-02 | Editar umbrales | U | Stock mínimo / máximo / alertas | `PUT /inventory/alert-settings` | No |

## A15. Notificaciones

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A15-01 | Listar notificaciones enviadas | R | Evento, destinatario enmascarado, estado; botón "Actualizar" | `GET /notifications` | No |
| A15-02 | Reintentar envío | P | Botón "Reintentar envío" (bloqueado si corte de emergencia activo) | `POST /notifications` | No |

## A16. Webhook Logs

| ID | Función | Tipo | Detalle | API | Mueve inventario |
|---|---|---|---|---|---|
| A16-01 | Listar llamadas al webhook | R | Filtros; paginación | `GET /webhook/logs` | No |
| A16-02 | Ver detalle de llamada | R | Acción, usuario, estado, respuesta | `GET /webhook/logs/{id}` | No |

## A17. Funciones de servidor sin pantalla propia

| ID | Función | Tipo | Detalle | API |
|---|---|---|---|---|
| A17-01 | Salud del sistema | R | DB conectada y tablas críticas | `GET /health` |
| A17-02 | Proveedores | R | Lista de proveedores sincronizados (usado en OC y maquila) | `GET /suppliers` |
| A17-03 | **[CONDICIONAL]** Ping de depuración | R | Solo si `ENABLE_DEBUG_ENDPOINTS=true` | `GET /debug/ping` |
| A17-04 | **[CONDICIONAL]** Migración de mapa | P | Solo si `ENABLE_HTTP_MIGRATIONS=true` | `/inventory/mapa-migrate` |

---

# COMPONENTE B — Agente WhatsApp y mensajes automáticos

## B0. Funcionamiento general

| ID | Función | Detalle |
|---|---|---|
| B0-01 | Recepción del mensaje | WhatsApp → BuilderBot → IA clasifica → `POST /api/v1/webhook/builderbot` con `from`, `info`, `document_text`, `document_url` |
| B0-02 | Autenticación del webhook | Header `X-BuilderBot-Secret`; `g0m@s` solo es palabra de enrutamiento |
| B0-03 | Identificación del usuario | Por teléfono; usuario inactivo o desconocido es rechazado |
| B0-04 | Control de permisos | Cada acción exige su capacidad (mismo modelo que el panel) |
| B0-05 | Confirmación explícita | Acciones que mueven inventario exigen frase exacta con número o ID corto |
| B0-06 | Respuesta | JSON `{mensaje}`; nunca se muestra el JSON interno de la IA |
| B0-07 | Registro | Cada llamada queda en `webhook_logs` (ver A16) |
| B0-08 | Formato de mensajes | Emojis operativos, IDs resaltados, corrección de textos |

## B1. Consultas por WhatsApp (no modifican)

| ID | Acción | Qué hace | Capacidad |
|---|---|---|---|
| B1-01 | CONSULTAR_STOCK_MATERIA_PRIMA | Stock disponible por producto y lote | inventory.read |
| B1-02 | CONSULTAR_STOCK_PRODUCTO_TERMINADO | Stock disponible por producto y lote | inventory.read |
| B1-03 | CONSULTAR_TRAZABILIDAD_LOTE | Recorrido de un lote | inventory.read |
| B1-04 | CONSULTAR_CAPACIDAD_FABRICACION | Cuánto se puede fabricar | production.read |
| B1-05 | CONSULTAR_ESTADO_PRODUCCION | Una orden o lista de activas | production.read |
| B1-06 | CONSULTAR_RECEPCIONES_PENDIENTES | Hasta 10 OC con saldo | reception.read |
| B1-07 | CONSULTAR_DESPACHOS_PENDIENTES | Despachos de facturas SIIGO, incluye 3Q | dispatch.read |
| B1-08 | **[PENDIENTE DE RETIRO]** CONSULTAR_SOLICITUDES_PENDIENTES | Aprobaciones en espera | approvals.read |
| B1-09 | MODO_CHARLA | Conversación sin acción | dashboard.view |

## B2. Documentos PDF (solo borradores)

| ID | Acción | Qué hace |
|---|---|---|
| B2-01 | REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO | PDF con encabezado "ORDEN DE COMPRA" → borrador (ver A3-05) |
| B2-02 | REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO | PDF "SALIDA DE BODEGA HACIA 3Q" / "REMISION A 3Q" → borrador (ver A8-08) |
| B2-03 | REGISTRAR_VISTA_PREVIA_RECEPCION_MAQUILA_DOCUMENTO | Vista previa de recepción de maquila |
| B2-04 | Validaciones documentales | Marcador ausente o contradictorio falla cerrado; PDF solo HTTPS de dominios BuilderBot, máx. 2.5 MB, firma PDF; contenido fuera de logs |

## B3. Compras y recepciones por WhatsApp

| ID | Acción | Qué hace | Mueve inventario |
|---|---|---|---|
| B3-01 | REVISAR_BORRADOR_ORDEN_COMPRA | Muestra borrador | No |
| B3-02 | CONFIRMAR_BORRADOR_ORDEN_COMPRA | Crea OC operativa (frase exacta) | No |
| B3-03 | PREPARAR_RECEPCION_OC | Prepara recepción con saldo | No |
| B3-04 | CONFIRMAR_RECEPCION_OC | "Confirmo la recepción NUMERO-OC / ID N" | **Sí** |
| B3-05 | PREPARAR_RECEPCION_MAQUILA | Prepara recepción de producto 3Q | No |
| B3-06 | CONFIRMAR_RECEPCION_MAQUILA | Confirma recepción 3Q | **Sí** |
| B3-07 | **[FUERA]** INGRESO_RECEPCION | Ingreso anterior; hoy se recibe contra OC o maquila | **Sí** |

## B4. Producción por WhatsApp

| ID | Acción | Qué hace | Mueve inventario |
|---|---|---|---|
| B4-01 | **[PENDIENTE DE RETIRO]** SOLICITAR_INICIO_PRODUCCION | Solicitud → aprobación supervisor | Tras aprobar |
| B4-02 | LIBERAR_ORDEN_PRODUCCION | Libera orden | **Sí** (reserva) |
| B4-03 | CONFIRMAR_MATERIALES_PRODUCCION | Confirma picking | **Sí** |
| B4-04 | AVANCE_FASES | Avanza fase | No |
| B4-05 | AJUSTAR_MATERIALES_PRODUCCION | Ajusta consumo | **Sí** |
| B4-06 | PREPARAR_REPOSICION_PRODUCCION | Prepara reposición | **Sí** (reserva) |
| B4-07 | CONFIRMAR_REPOSICION_PRODUCCION | Confirma reposición | **Sí** |
| B4-08 | CANCELAR_REPOSICION_PRODUCCION | Cancela reposición | **Sí** (libera) |
| B4-09 | **[PENDIENTE DE RETIRO]** SOLICITAR_CIERRE_PRODUCCION | Solicitud → aprobación | Tras aprobar |
| B4-10 | CERRAR_ORDEN_PRODUCCION | Cierre con lote terminado y mermas | **Sí** |
| B4-11 | REPORTE_MERMA | Merma con referencia automática | **Sí** |

## B5. Despachos, devoluciones y control por WhatsApp

| ID | Acción | Qué hace | Mueve inventario |
|---|---|---|---|
| B5-01 | SINCRONIZAR_FACTURAS_SIIGO | Fuerza importación de facturas | **Sí** (reserva) |
| B5-02 | CONFIRMAR_DESPACHO_SIIGO | Confirma salida física por referencia visible de factura. **También atiende salidas a 3Q**: el nombre interno no limita su alcance | **Sí** |
| B5-03 | **[FUERA]** SOLICITAR_DESPACHO | Solicitud directa anterior, desactivada por bandera | Tras aprobar |
| B5-04 | EXCEPCION_PICKING | Reporta problema al alistar | No |
| B5-05 | GESTION_DEVOLUCION | Devolución vinculada a despacho | **Sí** |
| B5-06 | AJUSTE_INVENTARIO | Ajuste con control de rol | **Sí** |
| B5-07 | **[PENDIENTE DE RETIRO]** APROBAR_SOLICITUD | "apruebo CÓDIGO" | **Sí** (según acción) |
| B5-08 | **[PENDIENTE DE RETIRO]** RECHAZAR_SOLICITUD | "rechazo CÓDIGO" | No |

## B6. Mensajes automáticos (WMS → API BuilderBot)

Transporte: `POST https://app.builderbot.cloud/api/v2/{BOT_ID}/messages`.

| ID | Evento | Disparador | Destinatarios |
|---|---|---|---|
| B6-01 | reception_pending | Factura de compra SIIGO importada | recepcion_cierre |
| B6-02 | dispatch_ready | Factura de venta importada con stock | despacho |
| B6-03 | dispatch_shortage | Factura de venta sin stock suficiente | despacho |
| B6-04 | dispatch_pending_customer | Cliente de la factura no sincronizado | admin |
| B6-05 | production_released | Orden liberada (A7-03 / B4-02) | alistador |
| B6-06 | production_started | Producción iniciada (A7-04 / B4-03) | admin, recepcion_cierre |
| B6-07 | production_replenishment_prepared | Reposición preparada (A7-06 / B4-06) | alistador |
| B6-08 | production_replenishment_confirmed | Reposición confirmada (A7-07 / B4-07) | admin, recepcion_cierre |
| B6-09 | production_replenishment_cancelled | Reposición cancelada (A7-08 / B4-08) | alistador |
| B6-10 | production_closed | Producción cerrada (A7-10 / B4-10) | admin |
| B6-11 | **[PENDIENTE DE RETIRO]** Solicitud de aprobación | B4-01, B4-09, B5-03 | supervisores |

Reglas de envío a probar:

| ID | Regla |
|---|---|
| B6-12 | Normaliza teléfonos colombianos (57XXXXXXXXXX) |
| B6-13 | Excluye al usuario que ejecutó la acción y usuarios bot |
| B6-14 | No repite el mismo evento al mismo destinatario |
| B6-15 | Rol sin usuarios → usa roles de respaldo (fallback) o registra advertencia |
| B6-16 | Corte de emergencia `DISABLE_OUTBOUND_NOTIFICATIONS=true` detiene envíos y reintentos |
| B6-17 | Registro en `notificaciones_salida` con destinatario enmascarado (ver A15) |

---

# COMPONENTE C — Integración WMS ↔ SIIGO

## C1. Conexión

| ID | Función | Tipo | Detalle | API WMS / SIIGO |
|---|---|---|---|---|
| C1-01 | Autenticación | P | Usuario + Access Key; token guardado en `siigo_config` | `POST /auth` |
| C1-02 | Reutilización de token | P | No pide token nuevo mientras esté vigente | — |
| C1-03 | Renovación de token | P | 5 minutos antes de vencer | `POST /auth` |
| C1-04 | Reintento tras 401 | P | Re-login y un reintento | — |
| C1-05 | Reintento tras 429 | P | Máx. 2 en lecturas; nunca en escrituras | — |
| C1-06 | Salud SIIGO | R | Admin/Supervisor | `GET /api/v1/siigo/health` → `GET /v1/document-types` |
| C1-07 | Bitácora | R | Toda llamada en `siigo_sync_log` con secretos redactados | — |

## C2. Catálogos (SIIGO → WMS)

| ID | Función | Tipo | Detalle | API WMS / SIIGO |
|---|---|---|---|---|
| C2-01 | Sincronizar tipos de documento | P | FV, FC, NC; guarda predeterminados | `POST /api/v1/siigo/sync-document-types` → `GET /v1/document-types` |
| C2-02 | Sincronizar productos | P | Todos o por códigos; crea/actualiza por código | `POST /api/v1/siigo/sync-products` → `GET /v1/products` |
| C2-03 | Sincronizar terceros | P | Todos o por identificación; clientes y proveedores | `POST /api/v1/siigo/sync-terceros` → `GET /v1/customers` |

## C3. Compras (SIIGO → WMS)

| ID | Función | Tipo | Detalle | API WMS / SIIGO |
|---|---|---|---|---|
| C3-01 | Importación automática de facturas de compra | P | Cron cada 2 min; cursor incremental | `/api/v1/siigo/import-purchases` → `GET /v1/purchases` |
| C3-02 | Importación dirigida | P | Por `purchase_ids` | ídem |
| C3-03 | Vincular con OC | P | Requiere OC si `REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT=true` | — |
| C3-04 | Detectar edición antes de recibir | P | Actualiza recepción pendiente | — |
| C3-05 | Detectar eliminación antes de recibir | P | Recepción anulada | — |
| C3-06 | Conciliar después de recibir | P | Alertas FACTURA_MODIFICADA / FACTURA_ELIMINADA, sin tocar stock | — |
| C3-07 | Validaciones | P | Bodega única, bodega mapeada a BG-PPAL, SKU existente | — |
| C3-08 | Notificación | P | Dispara B6-01 | — |

## C4. Ventas (SIIGO → WMS)

| ID | Función | Tipo | Detalle | API WMS / SIIGO |
|---|---|---|---|---|
| C4-01 | Importación automática de facturas de venta | P | Cron cada 2 min; cursor incremental | `/api/v1/siigo/import-invoices` → `GET /v1/invoices` |
| C4-02 | Importación manual | P | Desde A4-02 o B5-01 | ídem |
| C4-03 | Crear despacho con reserva FEFO | P | Estado picking | — |
| C4-04 | Bloqueos | P | Stock insuficiente, cliente no sincronizado, bodega no mapeada, SKU desconocido | — |
| C4-05 | Edición antes de despachar | P | Mismo despacho, reserva reconstruida | — |
| C4-06 | Eliminación / anulación antes de despachar | P | Despacho anulado, reservas liberadas | — |
| C4-07 | Edición después de despachar | P | Alerta FACTURA_MODIFICADA, sin tocar stock | — |
| C4-08 | Notificaciones | P | Disparan B6-02, B6-03, B6-04 | — |

## C5. Cotizaciones

| ID | Función | Tipo | Detalle | API WMS / SIIGO |
|---|---|---|---|---|
| C5-01 | Validar cotización y reservar | P | Rechaza si no hay stock | `/api/v1/siigo/validate-quotation` → `GET /v1/quotations/{id}` |
| C5-02 | Convertir a factura | P | Por prefijo `WMSCOT` o marcador `[WMS-COT:numero]` | — |
| C5-03 | Factura diferente o sin referencia | P | Bloqueada, reserva intacta | — |
| C5-04 | Cotización eliminada | P | Reserva liberada | — |

## C6. Cola, reintentos y escrituras

| ID | Función | Tipo | Detalle | API WMS / SIIGO |
|---|---|---|---|---|
| C6-01 | Consultar cola de sincronización | R | Pendientes y errores | `GET /api/v1/siigo/retry-sync` |
| C6-02 | Reprocesar cola | P | Hasta 5 referencias, idempotente | `POST /api/v1/siigo/retry-sync` |
| C6-03 | **[FUERA]** Crear factura de venta en SIIGO | C | Flujo anterior | `POST /v1/invoices` |
| C6-04 | **[FUERA]** Crear factura de compra en SIIGO | C | Flujo anterior | `POST /v1/purchases` |
| C6-05 | **[FUERA]** Envío a DIAN | P | Desactivado (`SIIGO_STAMP_SEND=false`) | — |

## C7. Webhooks (SIIGO → WMS)

| ID | Función | Detalle | Estado |
|---|---|---|---|
| C7-01 | Webhook productos | Actualiza producto | Protegido con secreto |
| C7-02 | Webhook facturas de venta | Aviso de factura | Solo Partner-Id; recomendado desactivar |
| C7-03 | Webhook facturas de compra | Aviso de compra | Solo Partner-Id; recomendado desactivar |
| C7-04 | Webhook notas crédito | Aviso de nota crédito | Solo Partner-Id; recomendado desactivar |
| C7-05 | **[CONDICIONAL]** Suscribir webhooks | Registra URLs en SIIGO | Bloqueado en sandbox compartido (409); evaluable con cuenta propia |

## C8. Limitaciones conocidas de SIIGO

| ID | Limitación | Manejo en el WMS |
|---|---|---|
| C8-01 | No hay API de órdenes de compra | OC se crean en el WMS (A3-02) |
| C8-02 | SIIGO permite sobreventa | El WMS bloquea (C4-04) |
| C8-03 | Filtros de fecha no funcionan en sandbox | Lectura de páginas recientes con filtro local |

---

# Flujos de extremo a extremo (cruzan los 3 componentes)

| ID | Flujo | Funciones involucradas |
|---|---|---|
| E2E-01 | Compra directa | A3-02 o B2-01→A3-07/B3-02 → A3-10/B3-03 → A3-15/B3-04 → C3-01→C3-03 → B6-01 → A10-01 |
| E2E-02 | Venta y despacho | Factura en SIIGO → C4-01 → C4-03 → B6-02 → A4-05/B5-02 → A6-02 → A10-01 |
| E2E-03 | Venta sin stock | C4-01 → C4-04 → B6-03 → A2-07 |
| E2E-04 | Venta con cotización | C5-01 → factura SIIGO → C5-02 → A4-05 |
| E2E-05 | Producción interna | A7-03/B4-02 → B6-05 → A7-04/B4-03 → B6-06 → A7-06..08 → B6-07..09 → A7-09 → A7-10/B4-10 → B6-10 |
| E2E-06 | **[PENDIENTE DE RETIRO]** Producción con aprobación | B4-01 → B6-11 → A11-03/B5-07 → ejecución. Sustituido por E2E-05 |
| E2E-13 | In & Out | A3-02 → A3-10 → A3-18 → A3-19 → venta E2E-02 |
| E2E-14 | Recepción mixta | A3-02 con ítems IO y no IO → A3-20 → A3-22 → A10-01 |
| E2E-15 | Depuración verificada | DEP-01 a DEP-07 |
| E2E-07 | Maquila 3Q | B2-02 → A8-03 o A8-02 → A8-04 → A8-06 → A3-11/B3-05 → A3-15/B3-06 → C3-01 |
| E2E-08 | Devolución | A4-05 → A5-02/B5-05 → A6-03 → A10-01 |
| E2E-09 | Merma | A9-02/B4-11 → A2-05 → A10-01 |
| E2E-10 | Cambios en SIIGO | C3-04..06, C4-05..07 con verificación en A3-17, A4-01, A2-07 |
| E2E-11 | Permisos por rol | Cada rol de la sección 0 contra pantallas A y acciones B |
| E2E-12 | Conciliación final | A6-01 vs SIIGO inventario, A10-01, C6-01 en cero |

# Resumen de cantidades

| Componente | Total | Vigentes | Fuera | Pendiente de retiro | Condicional |
|---|---|---|---|---|---|
| A. Panel web WMS | 102 | 89 | 5 | 6 | 2 |
| B. Agente WhatsApp y mensajes | 56 | 49 | 2 | 5 | 0 |
| C. Integración SIIGO | 43 | 39 | 3 | 0 | 1 |
| Flujos extremo a extremo | 15 | 14 | 0 | 1 | 0 |
| Casos de depuración | 7 | 7 | — | — | — |

Alcance de la batería: **191 funciones vigentes**, 14 flujos de extremo a extremo y 7 casos de depuración. Quedan fuera 10 funciones por flujo anterior, 12 pendientes de retiro y 3 condicionadas al entorno.
