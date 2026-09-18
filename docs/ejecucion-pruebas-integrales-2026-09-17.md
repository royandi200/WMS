# Ejecucion de pruebas integrales - 17 de septiembre de 2026

Entorno: `https://wms-seven-ebon.vercel.app` (produccion, sistema aun no en operacion), commit `9fc1a48` de `main` con la depuracion aplicada.
Sesion: Admin WMS (id 1, capacidades `*`), iniciada por el usuario en el navegador integrado; las pruebas reutilizan el token de esa sesion.
Metodo: cada accion se ejecuta por una via (pantalla o API) y se verifica por otra (API, base o pantalla). Tambien se prueban los casos que deben fallar.
Datos de prueba: prefijo `WMSQA260917`.
Referencia de IDs: `docs/inventario-detallado-plataforma-wms.md`.

## Linea base

| Indicador | Valor |
| --- | --- |
| Productos con disponible | 15 |
| Disponible | 9.020 g, 1.237 und |
| Reservado | 0 |
| Despachos | 7 |
| Recepciones | 23 |
| Devoluciones | 0 |
| Cola Siigo | 0 pendientes |
| Notificaciones | 96 enviadas, 4 con error; ultima 2026-09-10 |
| Usuarios activos con telefono | Juan (admin), Datana y Jobana (recepcion_cierre) |

## Hallazgos previos a la ejecucion

| ID | Hallazgo | Impacto |
| --- | --- | --- |
| H-01 | Las notificaciones salientes estan activas en produccion y llegan a telefonos reales. | Las pruebas de produccion requieren `DISABLE_OUTBOUND_NOTIFICATIONS=true` durante la bateria. |
| H-02 | `GET /api/v1/siigo/health` responde 401 en produccion: la AccessKey configurada en Vercel no es valida. | Importacion de compras y ventas desde Siigo no funciona hasta renovar la llave. |
| H-03 | `main` recibio en paralelo `a9a3868` (retiro visual de Aprobaciones, Juan). La rama de depuracion se integro sobre ese commit sin perdida. | Ninguno; documentado en `depuracion-flujos-retirados-2026-09.md`. |

## Resultados

| Caso | Resultado | Evidencia |
| --- | --- | --- |
| DEP-01 Aprobaciones fuera de menu y dashboard | APROBADO | Menu lateral, menu inferior y dashboard sin la palabra; `/aprobaciones` redirige al inicio |
| DEP-02 Endpoints de aprobaciones | APROBADO | `GET /approvals`, `GET /approvals/pending`, `POST /approvals/approve`, `POST /approvals/reject` responden 410 |
| DEP-05 Despacho directo y recepcion manual | APROBADO | `POST /dispatch` 409 "El despacho directo esta desactivado"; `POST /reception` sin OC 409 "Inicia la recepcion desde una orden de compra abierta"; conteos sin cambio (7 despachos, 23 recepciones) |
| A12-03 Crear producto (pantalla) | APROBADO | `WMSQA260917-P01` creado, id 412, activo; confirmado por API |
| A12-03 SKU duplicado | APROBADO | Pantalla y API: 409 "El codigo SKU ya existe"; un solo registro |
| A12-03 Campos vacios | APROBADO | 400 "sku/siigo_code y name son requeridos" |
| A12-04 Editar producto (pantalla) | APROBADO | Nombre y unidad actualizados; confirmado por `GET /products/412` |
| A12-05 Activar / inactivar | **FALLA (B-01)** | Boton "Inactivar" sin efecto; `PATCH /products/412/toggle` responde 405 con cuerpo vacio |
| A6-07 Crear ubicacion | APROBADO | `WMSQA260917-U1` id 184 en BG-PPAL |
| A6-07 Ubicacion duplicada | APROBADO | 409 "Ya existe una ubicacion con ese codigo" |
| A6-08 Editar ubicacion | APROBADO | Nivel 1→2, posicion a→b; reflejado en listado y mapa |
| A6-09 Eliminar ubicacion con stock | APROBADO | 409 "No se puede eliminar: tiene stock asignado"; la ubicacion permanece |
| A3-02 Crear OC con PDF (pantalla) | APROBADO | `WMSQA260917-OC01` id 35, CARGADA, PDF adjunto, proveedor sincronizado |
| A3-02 Validaciones de OC (7 casos) | APROBADO | Sin PDF 400; archivo no PDF 400; cantidad 0 400; SKU inexistente 404; proveedor no sincronizado 404; sin items 400; numero repetido con contenido distinto 409. Una sola OC creada |
| A3-03 Descargar PDF de OC | APROBADO | 200 `application/pdf` 448 B |
| A3-18 Identificador segun modalidad | APROBADO | OC de producto sin modalidad IO se ofrece como "OC ID 35"; la OC 34 In & Out como "IO ID 34" |
| A3-10 Preparar recepcion desde OC | APROBADO | `REC-OC-35-001` borrador; pendiente 10 und; mensaje "El inventario solo cambiara al aprobar" |
| A3-15 Recepcion parcial 6/10 (pantalla) | APROBADO | Stock 6, lote `WMSQA260917LOT01` qty 6, kardex `INGRESO_RECEPCION` +6 saldo 6, OC `RECIBIDA_PARCIAL`, mapa ubicacion 184 con 6, novedad de faltante registrada |
| A3-10 Segunda recepcion con saldo | APROBADO | `REC-OC-35-002` con pendiente 4 und |
| A3-14 Sobrante como disponible | APROBADO | Rechazado: "El sobrante no puede ingresar como disponible... deja el excedente en CUARENTENA o PENDIENTE_DISPOSICION" |
| A3-13 Distribucion 4 disponible + 1 cuarentena | APROBADO (con B-02, B-03) | Stock 11: 10 disponible, 1 bloqueada; OC `CERRADA`; novedades: faltante 4 (REC-001), sobrante 1 (REC-002) |
| A3-15 Preparar recepcion de OC cerrada | APROBADO | 409 "La orden de compra esta CERRADA" |
| A3-04 Cancelar OC cerrada | APROBADO | 409 "no se puede cancelar en estado CERRADA" |
| A9-02 Merma mayor al saldo del lote (pantalla) | APROBADO | "Stock disponible insuficiente: 6"; disponible sin cambio (10) |
| A9-02 Merma valida 1 und (pantalla) | APROBADO | "Merma registrada correctamente" `MER-BA06CC35`; disponible 10→9; kardex `MERMA_BODEGA` -1 |
| A9-02 Merma repetida con misma referencia | APROBADO | Devuelve el mismo registro id 46; disponible sigue en 9; una sola merma y un solo asiento de kardex |
| A5-02 Devolucion mayor a lo despachado (pantalla) | APROBADO | "Despachadas: 2. Ya devueltas: 0. Puedes devolver como maximo: 2" |
| A5-02 Lote distinto / SKU no despachado | APROBADO | 409 "El lote no pertenece al despacho indicado"; mensaje visible en pantalla |
| A5-02 Factura inexistente | APROBADO | 404 "Despacho o factura origen no encontrado"; mensaje visible en pantalla |
| A5-02 Devolucion valida 1 und a cuarentena (pantalla) | APROBADO | `DEV-4B9BBA09` sobre despacho 68 (FV-DEMO-ACC-260910-IO-001); lote en CUARENTENA; kardex `DEVOLUCION` +1 |
| A5-02 Devolucion repetida | APROBADO | "La devolucion DEV-4B9BBA09 ya estaba registrada. No se modifico inventario."; total sigue en 1 |
| A5-02 Exceso sobre saldo restante | APROBADO | "Ya devueltas: 1. Puedes devolver como maximo: 1" |
| A4-01 Listar despachos (pantalla) | APROBADO | Pendientes y Historico; cada despacho aparece una vez con sus items (la API devuelve una fila por item y la pantalla agrupa) |
| A4-02 Consultar Siigo (pantalla) | FALLA ESPERADA por H-02 (con O-04) | Muestra "Request failed with status code 401" |
| A4-04 Hoja imprimible | APROBADO | Abre documento `blob:` en nueva ventana |
| A6-02 Buscar producto (pantalla) | APROBADO | P01: disponible 9, bloqueado 1, total 10, custodia 3Q 0; partidas LOT01 5 y LOT02 4; coincide con API |
| A6-03 Buscar lote (pantalla) | APROBADO (con B-04) | LOT01 saldo 5, DISPONIBLE, vence 2027-12-31, BG-PPAL / WMSQA260917-U1; historico: +6 recepcion, -1 merma |
| A10-01 Kardex por SKU (pantalla) | APROBADO | 14 coincidencias para P01, incluye `REC-OC-35-001`, `REC-OC-35-002` y `MER-BA06CC35` con saldos por lote |
| A14-02 Editar stock minimo (pantalla) | APROBADO | 0→20 guardado; confirmado por API |
| A14-02 Stock minimo negativo | APROBADO | "Stock minimo invalido para WMSQA260917-P01"; valor se mantiene en 20 |
| A6-04 Stock bajo con minimo superior al saldo | **FALLA (B-05)** | P01 con disponible 9 y minimo 20 no aparece en `/inventory/low-stock` |
| A13-02 Cambiar rol (pantalla) | APROBADO | Usuario inactivo 17: recepcion_cierre → consulta → recepcion_cierre; confirmado por API |
| A13-02 Rol no permitido | APROBADO | 400 "Rol no permitido" |
| A13-02 Admin se retira su propio rol | APROBADO | 409 "No puedes retirar tu propio rol de administrador" |
| A15-01 Listar notificaciones (pantalla) | APROBADO | Telefonos enmascarados; 4 con boton de reintento (no se pulso: envios activos, H-01) |
| A16-01 Webhook logs (pantalla) | APROBADO | Filtros por estado, prioridad y telefono; paginacion |
| A8-02 Orden 3Q con producto que no es PT | APROBADO (con O-05) | Rechazada; sin reservas. Mensaje: "Producto WMSQA260917-P01 no encontrado" |
| A8-02 Orden 3Q valida (pantalla) | APROBADO | `MQ-3Q-20260918-000017` en MATERIALES_RESERVADOS, remision `REM-3Q-20260918-000018`; reserva FEFO de 1 und en 00001-TPBI, 00006-TRP, 00018-ETBOS60 y 00035-LNTP60 con lote y ubicacion de origen |
| A4-01 Salida a 3Q visible en Despachos | APROBADO | `3q-18` en estado picking en API y pantalla de Despachos |
| B DEP-03/04/06 Acciones retiradas por WhatsApp (webhook local) | APROBADO | `test/webhook-retired-actions.test.js`: las 7 acciones retiradas y "apruebo REQ-..." en lenguaje natural responden 200 con `RETIRED_FLOW` y la guia vigente, quedan en `webhook_logs` como REJECTED y no escriben fuera del log |
| B0-02 Autenticacion del webhook (local) | APROBADO (con S-01) | Sin secreto: no autorizado y sin consultar la base; secreto incorrecto: no autorizado; palabra clave publica: autoriza (S-01) |
| B0-03 Numero no registrado (local) | APROBADO | `UNREGISTERED_PHONE` sin escrituras |
| B6 Notificaciones con corte activado (local) | APROBADO | `test/builderbot-notifications.test.js`: no consulta la base, no registra, no envia; el reintento manual responde 409 |
| B6 Notificaciones encendidas (local, BuilderBot simulado) | APROBADO | POST a `app.builderbot.cloud/api/v2/{BOT_ID}/messages` con `x-api-builderbot`; numeros normalizados a 57XXXXXXXXXX; excluye autor, inactivos y telefonos invalidos; destinatarios enmascarados; registro PENDIENTE→ENVIADA |
| B6-14 Sin repeticion por evento y destinatario | APROBADO | Segundo envio del mismo evento: `duplicate`, un solo mensaje |
| B6-15 Rol sin destinatarios | APROBADO | Usa respaldo; sin respaldo registra advertencia `Notificacion sin destinatarios` |
| B6 Bot sin token configurado | APROBADO | Marca ERROR sin interrumpir la operacion |
| Suite automatica completa | APROBADO | `npm test` 402/402 |
| A8-07 Cancelar remision (pantalla) | APROBADO | Confirmacion "Cancelar REM-3Q-20260918-000018 y liberar sus reservas"; orden CANCELADA, remision anulada, las 4 reservas vuelven a 0 y los disponibles a los valores iniciales |

## Correcciones aplicadas (2026-09-18)

| ID | Correccion | Archivos | Estado |
| --- | --- | --- | --- |
| B-01 | Rewrite `/api/v1/products/:id/toggle` antes de `/products/:id`; mensaje de error de respaldo si la respuesta viene vacia. | `vercel.json`, `frontend/src/store/productsStore.js` | Pendiente de verificar desplegado |
| B-02 | El error de confirmacion se muestra junto al boton "Aprobar recepcion fisica" y permanece hasta el siguiente intento. Nota: el aviso superior existente si mostraba el motivo, pero desaparecia a los 4 s y quedaba fuera de la vista del usuario. | `frontend/src/pages/RecepcionPage.jsx` | Pendiente de verificar desplegado |
| B-03 | La lista de ubicaciones se filtra por la bodega de la recepcion preparada. | `frontend/src/pages/RecepcionPage.jsx` | Pendiente de verificar desplegado |
| B-04 | La consulta de producto toma ubicacion y lote proveedor desde `recepcion_distribuciones` cuando la partida bloqueada no tiene fila en `stock`; la pantalla muestra el lote proveedor y la partida interna. El lote tecnico `RECBLK-` es intencional (separa lo bloqueado del lote disponible). | `api/v1/inventory/product/[id].js`, `frontend/src/pages/InventarioPage.jsx` | Pendiente de verificar desplegado |
| B-05 | Stock bajo y resumen dependen de `stock_minimo > 0`, sin exigir `control_stock = 1`. Cubre productos creados en el panel y el catalogo cargado por acta. | `api/v1/inventory/low-stock.js`, `api/v1/inventory/summary.js` | Pendiente de verificar desplegado |
| O-06 | Saludo del agente sin "aprobaciones". | `api/v1/webhook/builderbot.js` | Aplicado |

Pruebas: `test/qa-fixes-2026-09-18.test.js`; suite completa 409/409 y build de Vite aprobados.

## Defectos y observaciones

| ID | Tipo | Descripcion | Evidencia | Correccion propuesta |
| --- | --- | --- | --- | --- |
| S-01 | **Seguridad critica** | El webhook de BuilderBot acepta la palabra `g0m@s` como autenticacion alternativa al secreto. El repositorio `royandi200/WMS` es **publico** y la palabra aparece en 11 archivos (incluidos `.env.example` y los prompts), junto con la URL del webhook. Cualquiera puede suplantar un telefono registrado, incluido un admin, y ejecutar acciones que mueven inventario. `plan-implementacion-pendientes-post-qa.md` ya exigia que `g0m@s` nunca autenticara. | `requireBuilderBotAccess` en `api/v1/webhook/builderbot.js:238`. Verificado por lectura de codigo; no se exploto contra produccion. | 1) Hacer privado el repositorio. 2) Confirmar que BuilderBot envia `X-BuilderBot-Secret`. 3) Retirar el respaldo por `kw` y rotar `BUILDERBOT_WEBHOOK_SECRET`. |
| B-01 | Defecto | Activar/inactivar producto no funciona. La pantalla no informa el error. | `PATCH /api/v1/products/412/toggle` → 405 vacio. El handler `api/v1/products/[id]/toggle.js` existe; `vercel.json` enruta `/products/:id` pero no `/products/:id/toggle`, que cae en la regla SPA. | Agregar rewrite `/api/v1/products/:id/toggle` → `/api/v1/products/[id]/toggle` antes de la regla de `/products/:id`; mostrar error en pantalla. |
| B-02 | Defecto | Al aprobar una recepcion rechazada por el servidor, la pantalla no muestra el motivo: el boton no produce efecto visible. | `PUT /reception` → 400 "Una ubicacion no pertenece a la bodega de recepcion"; sin mensaje en pantalla. | Mostrar `error` de la respuesta en la recepcion. |
| B-03 | Defecto | La lista de ubicaciones de recepcion ofrece ubicaciones de otras bodegas (BG-CUAR, BG-DEVOL, BG-PROD) que el servidor rechaza. | Opciones con 4 bodegas; solo BG-PPAL es valida para la OC. | Filtrar por la bodega de la recepcion. |
| B-04 | Defecto | La unidad recibida en cuarentena queda como partida `RECBLK-57d1...` sin ubicacion (estado SIN_UBICACION) y sin el lote del proveedor (`WMSQA260917LOT02`), aunque la recepcion la asigno a `BG-PPAL / CUAR-C-1-01`. | Buscar producto P01; kardex `INGRESO_RECEPCION` +1 lote `RECBLK-...` ubicacion `-`. | Revisar si es diseno (partida bloqueada tecnica) o perdida de trazabilidad; como minimo conservar lote proveedor y ubicacion. |
| B-05 | Defecto | Stock bajo solo considera productos con `control_stock = 1` (dato de Siigo). Un producto creado en el panel queda con `control_stock = 0`, sin forma de cambiarlo, y la pantalla de alertas permite fijarle un minimo que nunca dispara. | `api/v1/inventory/low-stock.js` filtra `p.control_stock = 1 AND p.stock_minimo > 0`. | Activar control de stock al crear en el panel, o no exigirlo cuando hay minimo configurado. |
| O-03 | Observacion | La API de despachos devuelve una fila por item (la remision 3Q-17 aparece 5 veces con el mismo id); la pantalla agrupa correctamente. | `GET /dispatch`. | Solo relevante para integraciones que consuman la API. |
| O-04 | Observacion | "Consultar Siigo" muestra el error tecnico "Request failed with status code 401". | Pantalla Despachos. | Traducir a "No se pudo conectar con Siigo: credenciales invalidas". |
| O-06 | Observacion | El saludo del agente ofrece ayuda con "aprobaciones", circuito retirado. | `api/v1/webhook/builderbot.js:1346`. | Quitar "aprobaciones" del saludo. |
| O-07 | Observacion | Con el corte de notificaciones activado, los eventos no se registran en `notificaciones_salida`; al reactivar no hay cola que enviar. | `notifyRoles` retorna `disabled` antes de consultar la base. | Aceptable como corte de emergencia; documentarlo. |
| O-05 | Observacion | Al pedir a 3Q un producto que existe pero no es PT, el mensaje dice "no encontrado". | Maquila 3Q, remision manual. | "El producto WMSQA260917-P01 no es de modalidad PT (maquila)". |
| O-01 | Observacion | El selector "Tipo" de producto solo ofrece `Product`, aunque la pantalla define etiquetas para producto terminado, materia prima, empaque, insumo y otro. No hay campo para modalidad operativa (PR/PT/IO). | Formulario Nuevo producto. | Decidir si el tipo y la modalidad se administran desde Siigo o desde el WMS. |
| O-02 | Observacion | Cambiar la unidad del producto despues de crear la OC modifica la unidad mostrada del lote (kg) aunque la OC se ordeno en und. | Producto 412 editado a kg; OC en und; lote muestra kg. | Bloquear el cambio de unidad con movimientos o registrar conversion. |
