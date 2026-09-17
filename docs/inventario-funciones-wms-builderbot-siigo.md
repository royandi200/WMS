# Inventario de funciones del WMS

Fecha: 16 de septiembre de 2026
Fuente: revisión del código del repositorio `royandi200/WMS` (rama `main`): `api/v1` (58 funciones del servidor), `frontend/src/pages` (16 pantallas), webhook de BuilderBot (39 acciones) y notificaciones salientes.

Contenido:

1. Funciones del WMS (panel web + API)
2. Webhook de BuilderBot: lo que el agente de WhatsApp puede hacer
3. Mensajes que el sistema envía por WhatsApp (API de BuilderBot)
4. Funciones entre el WMS y SIIGO

---

## 1. Funciones del WMS (panel web + API)

| Módulo | Qué hace | Pantalla / API |
|---|---|---|
| Acceso y usuarios | Login con token, renovación de sesión, usuarios con roles (Admin, Supervisor, alistador, recepción/cierre, despacho…) y permisos por capacidad | `LoginPage`, `UsuariosPage` · `auth/*`, `users` |
| Dashboard | Indicadores de entradas, salidas y stock crítico | `DashboardPage` · `dashboard` |
| Productos | Catálogo (materia prima, insumos, IO, PR, PT), activar o desactivar, alias humanos | `ProductosPage` · `products/*` |
| Proveedores | Terceros proveedores sincronizados desde SIIGO | `suppliers` |
| Órdenes de compra | Crear OC con PDF validado y proveedor sincronizado, borradores leídos desde PDF, cancelación auditable | `RecepcionPage` · `purchase-orders`, `warehouse-documents` |
| Recepciones | Recepción física contra OC, parcial o total, con lote, vencimiento, ubicación y condición (disponible, cuarentena, rechazo); novedades de faltante, dañado y sobrante | `RecepcionPage` · `reception` |
| Inventario | Stock por producto, lote y ubicación, antigüedad, stock bajo con umbrales configurables, mapa visual de bodega | `InventarioPage`, `AlertSettingsPage` · `inventory/*` |
| Kardex / trazabilidad | Historial de movimientos por producto y lote | `KardexPage` · `inventory/kardex`, `inventory/lot/[lpn]` |
| Producción | Órdenes de producción: liberar, iniciar, avanzar fases, ajustar materiales, reponer (preparar, confirmar, cancelar) y cerrar con resultado y mermas | `ProduccionPage` · `production/*` |
| Maquila 3Q | Orden de maquila, reserva FEFO de materiales, remisión a 3Q, custodia externa, recepción parcial del producto terminado | `OutsourcingPage` · `outsourcing` |
| Despachos | Tareas creadas desde facturas de SIIGO, reserva FEFO, alistamiento con ubicación, confirmación de salida | `DespachoPage` · `dispatch` |
| Devoluciones | Vinculadas al despacho o factura original, con lote | `DevolucionesPage` · `returns` |
| Mermas | Registro transaccional e idempotente | `MermasPage` · `waste` |
| Aprobaciones | Solicitudes que requieren aprobación del supervisor (aprobar o rechazar) | `AprobacionesPage` · `approvals/*` |
| Notificaciones y logs | Historial de mensajes enviados y de llamadas al webhook | `NotificacionesPage`, `WebhookLogsPage` |
| Salud | Verificación de base de datos y tablas | `health` |

---

## 2. Webhook de BuilderBot: lo que el agente de WhatsApp puede hacer

Flujo: WhatsApp → BuilderBot (la IA clasifica el mensaje) → `POST /api/v1/webhook/builderbot` → el WMS ejecuta la acción y responde con `{mensaje}`.

Reglas generales:

- El usuario se identifica por su teléfono y cada acción se valida contra su rol.
- Las acciones que mueven inventario exigen una frase de confirmación explícita en el mensaje actual.
- El JSON interno de la IA nunca se muestra al usuario.

### 2.1 Consultas (no modifican nada)

| Acción | Qué hace |
|---|---|
| `CONSULTAR_STOCK_MATERIA_PRIMA` | Stock disponible de materia prima por producto y lote |
| `CONSULTAR_STOCK_PRODUCTO_TERMINADO` | Stock disponible de producto terminado por producto y lote |
| `CONSULTAR_TRAZABILIDAD_LOTE` | Recorrido completo de un lote |
| `CONSULTAR_CAPACIDAD_FABRICACION` | Cuánto se puede fabricar con el inventario disponible |
| `CONSULTAR_ESTADO_PRODUCCION` | Estado de una orden de producción, o lista de las activas |
| `CONSULTAR_RECEPCIONES_PENDIENTES` | Hasta 10 OC con saldo por recibir |
| `CONSULTAR_DESPACHOS_PENDIENTES` | Despachos pendientes originados en facturas de SIIGO, incluidos los de 3Q |
| `CONSULTAR_SOLICITUDES_PENDIENTES` | Aprobaciones en espera |
| `MODO_CHARLA` | Conversación general, sin acción |

### 2.2 Documentos PDF (solo crean borradores, nunca tocan inventario)

| Acción | Qué hace |
|---|---|
| `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO` | Lee un PDF con encabezado "ORDEN DE COMPRA" y crea un borrador |
| `REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO` | Lee un PDF de remisión a 3Q y crea un borrador |
| `REGISTRAR_VISTA_PREVIA_RECEPCION_MAQUILA_DOCUMENTO` | Vista previa de la recepción de maquila desde un documento |

### 2.3 Compras y recepciones

| Acción | Qué hace |
|---|---|
| `REVISAR_BORRADOR_ORDEN_COMPRA` | Muestra el borrador de OC para revisión |
| `CONFIRMAR_BORRADOR_ORDEN_COMPRA` | Convierte el borrador en OC operativa |
| `PREPARAR_RECEPCION_OC` | Prepara la recepción con el saldo pendiente de la OC |
| `CONFIRMAR_RECEPCION_OC` | Confirma la recepción ("Confirmo la recepción…"); aquí entra el inventario |
| `PREPARAR_RECEPCION_MAQUILA` | Prepara la recepción de producto terminado que llega de 3Q |
| `CONFIRMAR_RECEPCION_MAQUILA` | Confirma la recepción de maquila |
| `INGRESO_RECEPCION` | Ingreso de recepción (flujo anterior) |

### 2.4 Producción

| Acción | Qué hace |
|---|---|
| `SOLICITAR_INICIO_PRODUCCION` | Pide iniciar una orden de producción; va a aprobación del supervisor |
| `LIBERAR_ORDEN_PRODUCCION` | Libera la orden para alistamiento |
| `CONFIRMAR_MATERIALES_PRODUCCION` | Confirma los materiales (reserva FEFO) |
| `AVANCE_FASES` | Registra el avance por fases |
| `AJUSTAR_MATERIALES_PRODUCCION` | Ajusta el consumo de materiales |
| `PREPARAR_REPOSICION_PRODUCCION` | Prepara una reposición de materiales |
| `CONFIRMAR_REPOSICION_PRODUCCION` | Confirma la entrega de la reposición |
| `CANCELAR_REPOSICION_PRODUCCION` | Cancela la reposición y libera lo reservado |
| `SOLICITAR_CIERRE_PRODUCCION` | Pide cerrar la producción; va a aprobación |
| `CERRAR_ORDEN_PRODUCCION` | Cierre con resultado, lote terminado y mermas |
| `REPORTE_MERMA` | Reporta merma con referencia automática |

### 2.5 Despachos, devoluciones y control

| Acción | Qué hace |
|---|---|
| `SINCRONIZAR_FACTURAS_SIIGO` | Fuerza la importación de facturas de venta desde SIIGO |
| `CONFIRMAR_DESPACHO_SIIGO` | Confirma la salida física de una factura; descuenta inventario |
| `SOLICITAR_DESPACHO` | Solicitud de despacho con aprobación (bloqueada si `ALLOW_DIRECT_DISPATCH_REQUEST=false`) |
| `EXCEPCION_PICKING` | Reporta un problema al alistar |
| `GESTION_DEVOLUCION` | Registra una devolución vinculada a su despacho |
| `AJUSTE_INVENTARIO` | Ajuste de inventario con control de rol |
| `APROBAR_SOLICITUD` | El supervisor responde "apruebo CÓDIGO" |
| `RECHAZAR_SOLICITUD` | El supervisor responde "rechazo CÓDIGO" |

---

## 3. Mensajes que el sistema envía por WhatsApp (API de BuilderBot)

Transporte: `POST https://app.builderbot.cloud/api/v2/{BUILDERBOT_BOT_ID}/messages` con la clave `BUILDERBOT_API_TOKEN` (servicio `api/_lib/builderbot-notifications.js`).

Comportamiento:

- Normaliza teléfonos colombianos.
- Excluye usuarios bot y al usuario que hizo la acción.
- No repite el mismo evento a la misma persona.
- Corte de emergencia: `DISABLE_OUTBOUND_NOTIFICATIONS=true` detiene envíos nuevos y reintentos.

| Evento | Cuándo se envía | A quién |
|---|---|---|
| `reception_pending` | Llega una factura de compra de SIIGO y queda una recepción pendiente | Recepción/cierre |
| `dispatch_ready` | Factura de venta importada y con stock reservado | Despacho |
| `dispatch_shortage` | Factura de venta importada pero sin stock suficiente | Despacho |
| `dispatch_pending_customer` | La factura trae un cliente que no está sincronizado en el WMS | Admin |
| `production_released` | Se liberó una orden de producción y hay que alistar materiales | Alistador |
| `production_started` | Inició la producción | Admin, recepción/cierre |
| `production_replenishment_prepared` | Se autorizó una reposición de materiales | Alistador |
| `production_replenishment_confirmed` | Se entregó la reposición | Admin, recepción/cierre |
| `production_replenishment_cancelled` | Se canceló la reposición | Alistador |
| `production_closed` | Se cerró la producción, con % de no conformes | Admin |
| Solicitud de aprobación | Inicio o cierre de producción, o despacho que requiere visto bueno ("apruebo / rechazo CÓDIGO") | Supervisores |

---

## 4. Funciones entre el WMS y SIIGO

Criterio del sistema: SIIGO es el origen contable y el WMS es la verdad física (lotes, ubicaciones, movimientos).

### 4.1 WMS → SIIGO (el WMS consulta)

| Función | API SIIGO | Qué hace |
|---|---|---|
| Autenticación | `POST /auth` | Obtiene el token, lo guarda, lo renueva 5 minutos antes de vencer y reintenta tras un 401 |
| Tipos de documento | `GET /v1/document-types` | Trae los tipos FV, FC y NC y guarda los predeterminados |
| Productos | `GET /v1/products` | Crea o actualiza el catálogo por código (unidad, impuestos, precio, código de barras) |
| Terceros | `GET /v1/customers` | Clientes y proveedores, con vendedor asignado |
| Importar facturas de compra (cada 2 min) | `GET /v1/purchases` | Crea o actualiza la recepción pendiente, la vincula con la OC, detecta ediciones y eliminaciones |
| Importar facturas de venta (cada 2 min) | `GET /v1/invoices` | Crea el despacho con reserva FEFO, bloquea si falta stock, cliente o bodega, detecta ediciones y anulaciones y crea alertas |
| Validar cotización | `GET /v1/quotations/{id}` | Reserva inventario antes de facturar; al llegar la factura con la referencia `WMSCOT`, la convierte sin reservar dos veces |
| Salud SIIGO | `GET /v1/document-types` | Prueba de conexión (Admin o Supervisor) |
| Reintentos | — | Cola de operaciones fallidas: `GET` la consulta, `POST` la reprocesa |
| Crear FV/FC desde el WMS (flujo anterior) | `POST /v1/invoices`, `POST /v1/purchases` | Se probó en julio. Ya no es el flujo vigente: hoy las facturas nacen en SIIGO |

Credenciales usadas: `SIIGO_USERNAME`, `SIIGO_ACCESS_KEY` y encabezado `Partner-Id` (`SIIGO_PARTNER_ID`).

### 4.2 SIIGO → WMS (webhooks, opcionales)

| Webhook | Qué hace | Estado |
|---|---|---|
| `siigo-products` | Actualiza un producto cuando cambia en SIIGO | Protegido con secreto |
| `siigo-invoices` | Aviso de facturas de venta | Solo valida `Partner-Id`; se recomienda desactivarlo y usar la consulta periódica |
| `siigo-purchases` | Aviso de facturas de compra | Solo valida `Partner-Id`; se recomienda desactivarlo |
| `siigo-credit-notes` | Aviso de notas crédito | Solo valida `Partner-Id`; se recomienda desactivarlo |
| `webhooks-subscribe` | Suscribe los webhooks en SIIGO | Bloqueado en el sandbox compartido |

### 4.3 Lo que la API de SIIGO no permite

- Órdenes de compra: SIIGO no las expone por API, por eso se crean en el WMS.
- Sobreventa: SIIGO la permite, así que el control de stock lo hace el WMS.
