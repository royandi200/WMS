# Mapa funcional del agente BuilderBot WMS

Este documento resume como funciona el agente WhatsApp/BuilderBot del WMS y como se conecta el prompt `Prompt WMS.txt` con el codigo activo del repositorio.

El objetivo es que una persona o IA pueda entender rapidamente que acciones reconoce el LLM, que handler ejecuta cada accion, que datos espera y donde hay diferencias importantes entre prompt y codigo.

## Flujo general

1. El usuario envia texto o audio por WhatsApp.
2. BuilderBot usa el prompt LLM1 para clasificar el mensaje.
3. LLM1 debe responder solo JSON con una accion (`@ction` o `action`), prioridad, `kw` y `params`.
4. BuilderBot envia ese JSON al endpoint `POST /api/v1/webhook/builderbot`.
5. El endpoint activo es `api/v1/webhook/builderbot.js` en Vercel Serverless.
6. El endpoint valida secreto de webhook, identifica al usuario por telefono, valida rol, ejecuta el handler y responde `message`/`mensaje`.
7. Algunas acciones no se ejecutan de inmediato: crean una solicitud `REQ-...` en `aprobaciones` y notifican a supervisores/admin por WhatsApp.

El stack Express de webhook en `backend/src/modules/webhook/builderbot.service.js` esta marcado como deprecado. No debe usarse como referencia principal.

## Contrato de entrada

BuilderBot envia normalmente:

```json
{
  "from": "573001112233",
  "info": "{\"@ction\":\"CONSULTAR_STOCK_MATERIA_PRIMA\",\"priority\":\"baja\",\"kw\":\"g0m@s\",\"params\":{\"id_item\":\"00051-MPASH\"}}"
}
```

El webhook acepta `info` como objeto o como string JSON. Lee la accion desde `info["@ction"]` o `info.action`.

Campos relevantes:

- `from`: telefono del usuario. Debe existir en `usuarios.telefono`, estar activo y no ser usuario bot.
- `@ction`/`action`: nombre exacto del handler.
- `priority`: prioridad informativa usada en logs.
- `kw`: en el prompt se usa como marcador de flujo (`g0m@s`). En el endpoint activo no funciona como secreto de seguridad.
- `params`: datos operativos de la accion.

La seguridad real del webhook depende de `requireWebhookSecret(req)`, que valida el secreto configurado en headers/autorizacion. `kw` no debe tratarse como autenticacion.

## Referencias de producto

Las referencias del prompt son ejemplos de Gummybox y seran reemplazadas por referencias reales del cliente.

El codigo no deberia depender de esas referencias de ejemplo. El handler busca productos por:

- `skus.sku`
- `productos.siigo_code`

Cuando se actualicen referencias reales del cliente hay que alinear:

- Catalogo y sinonimos del prompt `Prompt WMS.txt`.
- Tabla `productos`, especialmente `siigo_code`, `tipo_producto` y `activo`.
- Tabla `skus` para alias o codigos alternos.
- BOM de produccion (`bom.producto_final_id`, `bom.insumo_id`, `cantidad_por_unidad`).
- Stock/lotes iniciales si aplica.

No se deben cambiar nombres de handlers sin cambiar tambien el switch, RBAC y pruebas de webhook.

## Roles y acceso

El webhook aplica RBAC por accion.

- Operario, Supervisor y Admin pueden ejecutar operaciones normales, consultas, recepcion, produccion, merma, despacho solicitado, devolucion, confirmacion de materiales y excepcion de picking.
- Solo Supervisor y Admin pueden aprobar/rechazar solicitudes, hacer ajuste manual de inventario y consultar solicitudes pendientes.
- Telefonos no registrados reciben rechazo funcional y no se crea usuario fantasma.

## Ciclo de aprobaciones

Estas acciones crean una solicitud en `aprobaciones` y avisan a supervisores/admin:

- `SOLICITAR_INICIO_PRODUCCION`
- `SOLICITAR_CIERRE_PRODUCCION`
- `SOLICITAR_DESPACHO`

El supervisor responde con lenguaje natural como `apruebo REQ-000001` o `rechazo REQ-000001`. Si BuilderBot devuelve `UNKNOWN` o `MODO_CHARLA`, el webhook intenta detectar aprobacion/rechazo en texto libre antes del switch.

Al aprobar, `APROBAR_SOLICITUD` bloquea la solicitud pendiente, ejecuta el payload segun su accion original, marca `APROBADO` y notifica al operario cuando hay telefono en payload.

Al rechazar, `RECHAZAR_SOLICITUD` marca `RECHAZADO`, guarda motivo opcional y notifica al operario si aplica.

## Diccionario de parametros

| Parametro prompt | Uso en codigo | Notas |
| --- | --- | --- |
| `id_item` | SKU o `siigo_code` de producto/insumo | Se resuelve con `findProductBySku`. |
| `id_producto_final` | SKU o `siigo_code` de producto terminado | Se usa en produccion y capacidad. |
| `cantidad` | Cantidad operativa | En despacho se guarda internamente como `qty` dentro del payload de aprobacion. |
| `cantidad_planificada` | Cantidad planeada de orden | Crea orden `PLANEADA`. |
| `cantidad_real` | Cantidad final producida | Se ejecuta solo tras aprobacion de cierre. |
| `id_orden` | ID numerico o `codigo_orden` | Varias consultas aceptan ambos. |
| `id_lote` | LPN/lote fisico | En aprobacion de despacho se transforma a `lpn`. |
| `cliente_destino` | Cliente de despacho | Se guarda como `customer` en payload aprobado. |
| `cliente_origen` | Cliente de devolucion | Se guarda en recepcion/devolucion. |
| `estado` | Estado de devolucion | Normalizado a enum esperado. |
| `motivo` | Motivo de merma, rechazo o ajuste | Opcional en algunos handlers. |
| `fase_destino` | Nueva fase de produccion | Solo con orden `EN_PROCESO`. |
| `lote_sugerido` / `lote_usado` | Excepcion de picking | Se registra en `system_logs`. |

## Matriz de handlers

| Accion | Parametros principales del prompt | Implementacion actual | Resultado principal |
| --- | --- | --- | --- |
| `INGRESO_RECEPCION` | `id_item`, `cantidad`, opcional `cantidad_mala`, `proveedor` | Implementado directo | Crea recepcion, lote bueno, stock, movimientos y kardex. Si hay cantidad mala crea lote de novedad y kardex. |
| `SOLICITAR_INICIO_PRODUCCION` | `id_producto_final`, `cantidad_planificada` | Implementado con aprobacion | Valida BOM/stock, crea orden `PLANEADA`, crea `REQ-...` y notifica supervisores. Al aprobar reserva materiales y deja orden `APROBADA`. |
| `CONFIRMAR_MATERIALES_PRODUCCION` | `id_orden`, opcional `lote_usado` | Implementado directo | Descuenta insumos segun BOM, baja reserva, registra movimientos/kardex y pasa orden a `EN_PROCESO`. |
| `AVANCE_FASES` | `id_orden`, `fase_destino` | Implementado directo | Solo acepta orden `EN_PROCESO`; actualiza `fase` y agrega nota. |
| `REPORTE_MERMA` | `id_item`, `cantidad`, `motivo`, y `id_orden` o `id_lote` | Implementado directo | Crea registro de merma, movimiento de ajuste y kardex. Si hay lote, descuenta stock/lote. |
| `SOLICITAR_CIERRE_PRODUCCION` | `id_orden`, `cantidad_real` | Implementado con aprobacion | Encola cierre. Al aprobar exige orden `EN_PROCESO`, cierra orden, crea lote de PT `L-{SKU}-{ORDEN}-{timestamp}`, suma stock, movimiento y kardex. |
| `SOLICITAR_DESPACHO` | `id_item`, `cantidad`, `cliente_destino`, opcional `id_lote` | Implementado con aprobacion | Si no hay lote, selecciona FIFO automaticamente. Encola solicitud. Al aprobar descuenta stock/lote, registra salida/kardex y notifica. |
| `GESTION_DEVOLUCION` | `id_item`, `cantidad`, `cliente_origen`, `estado` | Implementado directo | Crea recepcion/devolucion y lote `L-DEV-...`. Si estado es cuarentena no suma stock disponible. |
| `CONSULTAR_STOCK_MATERIA_PRIMA` | opcional `id_item` | Implementado directo | Consulta vista `v_stock_disponible` filtrando tipo `MP`; lista top 10 o desglose FIFO por lote. |
| `CONSULTAR_STOCK_PRODUCTO_TERMINADO` | opcional `id_item` | Implementado directo | Consulta vista `v_stock_disponible` filtrando tipo `PT`; lista top 10 o desglose FIFO por lote. |
| `CONSULTAR_ESTADO_PRODUCCION` | `id_orden` | Implementado directo | Devuelve producto, estado, fase, cantidad planeada/real y fecha de cierre. |
| `CONSULTAR_TRAZABILIDAD_LOTE` | `id_lote` | Implementado directo | Busca en `lots` y kardex; si no existe, fallback a `stock`. |
| `CONSULTAR_CAPACIDAD_FABRICACION` | `id_producto_final`, `cantidad_deseada` | Implementado directo | Calcula demanda de insumos segun BOM y stock disponible. |
| `APROBAR_SOLICITUD` | `id_solicitud` | Implementado directo, solo Supervisor/Admin | Ejecuta payload pendiente para inicio, cierre o despacho. |
| `RECHAZAR_SOLICITUD` | `id_solicitud`, opcional `motivo` | Implementado directo, solo Supervisor/Admin | Marca solicitud pendiente como rechazada y notifica al operario si aplica. |
| `EXCEPCION_PICKING` | `lote_sugerido`, `lote_usado`, opcional `id_orden`, `id_item` | Implementado directo | Registra excepcion en `system_logs`; no ajusta stock por si solo. |
| `MODO_CHARLA` | `texto` | Implementado directo | Responde texto aclaratorio o mensaje generico. |

## Handlers adicionales en codigo

Estos handlers existen en `api/v1/webhook/builderbot.js`, pero no estan en el catalogo principal del prompt revisado:

| Accion | Uso | Recomendacion |
| --- | --- | --- |
| `AJUSTE_INVENTARIO` | Ajuste manual positivo o negativo por producto/lote. Solo Supervisor/Admin. | Agregar al prompt solo si se quiere operar desde WhatsApp; si no, mantenerlo fuera por riesgo operativo. |
| `CONSULTAR_SOLICITUDES_PENDIENTES` | Lista hasta 10 solicitudes pendientes. Solo Supervisor/Admin. | Conviene agregarlo al prompt para supervisores. |

## Gaps y diferencias prompt vs codigo

1. `kw` no se valida en el endpoint activo. El prompt lo exige como `g0m@s`, pero el codigo usa secreto de webhook. Esto esta bien desde seguridad, pero hay que documentarlo en BuilderBot como marcador de flujo, no como secreto.

2. El prompt ya fue actualizado para usar codigos Infinity reales y no debe generar `FG-`. Si vuelve a aparecer `FG-` en ejemplos o pruebas, debe tratarse como regresion del prompt.

3. `SOLICITAR_DESPACHO` tiene una tension interna en el prompt: una seccion exige extraer `id_lote` cuando aparece, otra recomienda omitir lote para FIFO automatico salvo mencion explicita. El codigo soporta ambos casos: si `id_lote` llega, usa ese lote; si no llega, selecciona FIFO.

4. El prompt lista referencias de productos de ejemplo. El sistema real resuelve por base de datos (`skus` y `productos.siigo_code`), por lo que las referencias definitivas deben cargarse en datos y replicarse en el prompt.

5. El prompt no incluye `CONSULTAR_SOLICITUDES_PENDIENTES`, aunque el codigo lo tiene. Es util para supervisores y deberia incorporarse.

6. El prompt no incluye `AJUSTE_INVENTARIO`. Por seguridad, es razonable mantenerlo fuera del prompt operativo general o exigir una politica explicita de aprobacion/roles.

7. `REPORTE_MERMA` en el prompt pide exactamente uno de `id_orden` o `id_lote`. El codigo acepta merma con orden o lote, y si no llega lote no descuenta stock especifico. Conviene mantener la restriccion estricta en prompt para evitar mermas ambiguas.

8. `CONFIRMAR_MATERIALES_PRODUCCION` recibe `lote_usado`, pero el codigo descuenta insumos por producto/bodega sin aplicar lote especifico por cada insumo. Si se requiere trazabilidad fina de insumos consumidos por lote, falta ampliar contrato y handler.

9. `EXCEPCION_PICKING` solo registra el evento. No corrige reservas, stock ni trazabilidad. Es adecuado como bitacora, pero no reemplaza un flujo de ajuste o consumo alterno.

10. Los mensajes y comentarios del archivo contienen algunos problemas de encoding visual. No afecta el comportamiento, pero dificulta lectura y mantenimiento.

## Funcionamiento por proceso

### Recepcion

`INGRESO_RECEPCION` registra entrada de producto o insumo. El producto se busca por SKU/`siigo_code`; se crea una recepcion completada, lote fisico, stock, movimiento y kardex. Si se informa `cantidad_mala`, se crea un lote de novedad separado.

### Produccion

El inicio se solicita con `SOLICITAR_INICIO_PRODUCCION`. Antes de crear la solicitud, el sistema calcula materiales segun BOM y stock disponible. Si hay faltantes, no crea orden. Si hay disponibilidad, crea orden `PLANEADA` y solicitud pendiente.

Al aprobar, la orden pasa a `APROBADA` y se reservan materiales. Luego el operario confirma con `CONFIRMAR_MATERIALES_PRODUCCION`, lo que descuenta insumos y pasa la orden a `EN_PROCESO`.

Durante produccion se puede usar `AVANCE_FASES` para registrar cambios de fase. El cierre se pide con `SOLICITAR_CIERRE_PRODUCCION`; al aprobar, se crea lote de producto terminado y entrada a inventario.

### Mermas

`REPORTE_MERMA` puede asociarse a proceso (`id_orden`) o bodega/lote (`id_lote`). Con lote, descuenta stock y actualiza estado si queda agotado. Con orden, valida que la orden este `EN_PROCESO`.

### Despacho

`SOLICITAR_DESPACHO` siempre debe tener producto y cantidad. Si el LLM no envia lote, el sistema elige FIFO por vista `v_stock_disponible`. Si envia lote, intenta usar ese lote. La salida real ocurre al aprobar la solicitud.

### Devoluciones

`GESTION_DEVOLUCION` crea recepcion, lote de devolucion y registro de devolucion. Si el estado normalizado es `CUARENTENA`, el lote queda bloqueado y no suma stock disponible.

### Consultas

Las consultas de stock usan `v_stock_disponible` y separan lotes disponibles, cuarentena y vencidos. Las consultas de produccion/lote/capacidad leen ordenes, lotes, kardex, BOM y stock.

## Recomendaciones para evolucionar el agente

1. Mantener una tabla de contrato LLM -> webhook con nombres exactos de handlers y parametros.
2. Cuando cambien referencias del cliente, actualizar primero datos maestros y luego prompt.
3. Agregar `CONSULTAR_SOLICITUDES_PENDIENTES` al prompt para supervisores.
4. Corregir la regla de prefijos y el ejemplo `FG-...` del prompt.
5. Decidir si `AJUSTE_INVENTARIO` debe existir por WhatsApp. Si se habilita, exigir rol supervisor/admin y probablemente aprobacion adicional.
6. Si el cliente exige trazabilidad completa por lote de insumo, ampliar `CONFIRMAR_MATERIALES_PRODUCCION` para recibir y consumir lotes especificos por insumo.
7. Crear pruebas de contrato con payloads JSON de ejemplo para cada accion antes de modificar prompt o handlers.
