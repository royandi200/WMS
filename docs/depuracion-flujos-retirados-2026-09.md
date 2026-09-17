# Depuracion de flujos retirados

Fecha de decision: 17 de septiembre de 2026
Rama: `depuracion/retiro-flujos-anteriores`
Origen: revision del inventario de funciones con el cliente (documentos `salvedades-inventario-funciones-wms-2026-09-17` y `guia-pruebas-inventario-detallado-wms-2026-09-17`).
Referencia de IDs: `docs/inventario-detallado-plataforma-wms.md`.

## Objetivo

Dejar en la herramienta unicamente los flujos vigentes, para ejecutar la bateria de pruebas integral sobre un sistema depurado.

## Estrategia en dos etapas

| Etapa | Alcance | Estado |
| --- | --- | --- |
| 1. Apagado | La funcionalidad deja de estar visible y de ejecutarse; responde con una guia hacia el flujo vigente. El codigo permanece para poder revertir sin rehacer desarrollo. | **Aplicada** |
| 2. Eliminacion | Borrar pantallas, handlers, tablas, semillas, scripts y pruebas asociadas. | Pendiente, posterior a la bateria de pruebas |

Razon de las dos etapas: el circuito de aprobaciones toca 78 archivos y unas 30 pruebas. Apagarlo primero permite probar la herramienta depurada de inmediato, sin arriesgar una reescritura amplia antes de las pruebas.

## Que se retiro

### 1. Circuito de aprobaciones (IDs A2-06, A2-08, A11-01..04, B1-08, B4-01, B4-09, B5-07, B5-08, B6-11, E2E-06)

Motivo: la produccion se libera y se cierra directamente; el cliente retiro el paso de aprobacion.

Riesgo que se elimina: una solicitud enviada por WhatsApp quedaba esperando una aprobacion que ya nadie atiende y, al aprobarse, movia inventario.

### 2. Solicitud directa de despacho (A4-06, B5-03)

Motivo: el despacho de cliente nace de una factura de venta de Siigo; la salida a 3Q se confirma en Despachos. Ya estaba desactivada por `ALLOW_DIRECT_DISPATCH_REQUEST=false`.

### 3. Ingreso manual de recepcion (A3-16, B3-07)

Motivo: se recibe contra OC operativa o contra orden de maquila 3Q vinculada. Ya estaba desactivado por `ALLOW_MANUAL_RECEPTION=false`.

### 4. Crear y eliminar usuarios desde el cliente (A13-03, A13-04)

Motivo: la API de usuarios solo acepta consultar y editar. Las funciones del cliente no tienen respaldo en el servidor. Pendiente de borrar en la etapa 2.

### 5. Creacion de facturas en Siigo desde el WMS y envio a DIAN (C6-03, C6-04, C6-05)

Motivo: flujo anterior. Hoy las facturas nacen en Siigo y `SIIGO_STAMP_SEND=false`. No requiere cambio de codigo en la etapa 1: ningun flujo vigente los invoca.

## No se retira (condicionado al entorno)

| ID | Funcion | Condicion |
| --- | --- | --- |
| A17-03 | Ping de depuracion | `ENABLE_DEBUG_ENDPOINTS=true` |
| A17-04 | Migracion de mapa por HTTP | `ENABLE_HTTP_MIGRATIONS=true` |
| C7-05 | Suscripcion de webhooks Siigo | Bloqueada en el sandbox compartido; evaluable con cuenta propia |

## Cambios aplicados en la etapa 1

| Archivo | Cambio |
| --- | --- |
| `api/_lib/retired-flows.js` | Nuevo. Concentra la decision: acciones retiradas, mensaje de redireccion y la escotilla `ENABLE_APPROVALS_WORKFLOW`. |
| `api/v1/webhook/builderbot.js` | Antes de validar permisos, una accion retirada responde con la guia vigente, se registra como `RETIRED_FLOW` en `webhook_logs` y no ejecuta nada. |
| `api/v1/approvals.js`, `api/v1/approvals/pending.js`, `api/v1/approvals/approve.js`, `api/v1/approvals/reject.js` | Responden HTTP 410 con el motivo mientras el circuito este apagado. |
| `frontend/src/components/Sidebar.jsx` | Se retira la entrada Aprobaciones. |
| `frontend/src/components/BottomNav.jsx` | Aprobaciones se sustituye por Despachos. |
| `frontend/src/App.jsx` | Se retira la ruta `/aprobaciones` y su carga diferida. |
| `frontend/src/pages/DashboardPage.jsx` | Se retiran la tarjeta Aprobaciones, la seccion Aprobaciones por tipo, la excepcion de aprobaciones pendientes y el acceso rapido; el indicador pasa a despachos y el acceso rapido a Produccion. |
| `test/retired-flows.test.js` | Nuevo. Comprueba el apagado, la insensibilidad a mayusculas y espacios, que las acciones vigentes no se bloqueen y que la escotilla restaure solo las aprobaciones. |

Verificacion ejecutada: `npm test` 380/380 en verde y build de Vite satisfactorio.

## Como revertir

- Circuito de aprobaciones: definir `ENABLE_APPROVALS_WORKFLOW=true` en el entorno. Las funciones y las acciones de WhatsApp vuelven a responder. La pantalla y las entradas de menu deben restituirse por codigo (`git revert` del commit del panel).
- Solicitud de despacho y recepcion manual: no dependen de esa bandera; conservan las suyas (`ALLOW_DIRECT_DISPATCH_REQUEST`, `ALLOW_MANUAL_RECEPTION`).

## Pendientes de la etapa 2

1. Eliminar `AprobacionesPage`, `approvalsStore`, `approvals.api.js` y los handlers de `api/v1/approvals*`.
2. Eliminar los casos del webhook de las siete acciones retiradas y sus ayudantes (`approval-policy`, `pending-approvals`, `approval-view`).
3. Decidir el destino de la tabla `aprobaciones` y de las semillas de demostracion; conservar el historico o archivarlo antes de borrar.
4. Retirar `createUser` y `deleteUser` del cliente del navegador.
5. Retirar `siigo.invoices.js` y `siigo.purchases.js` si se confirma que no se volvera a facturar desde el WMS.
6. Actualizar capacidades `approvals.read` y `approvals.decide`, y los roles que las usan.
7. Reescribir o eliminar las pruebas dependientes del circuito.

## Verificacion en la bateria de pruebas

Casos DEP-01 a DEP-07 del inventario detallado. Con la etapa 1 aplicada, DEP-01 a DEP-04 deben pasar.
