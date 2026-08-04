# Mapa operativo del agente WMS

## Proposito

Este documento describe el contrato vigente entre WhatsApp, BuilderBot Cloud, la API en Vercel, el dashboard y MySQL. Es la referencia para modificar handlers sin romper inventario, trazabilidad o autorizaciones.

El flujo historico basado en solicitudes `REQ-...` sigue presente para compatibilidad con registros anteriores, pero ya no es el flujo principal de recepcion, produccion ni despacho.

## Arquitectura activa

1. El usuario envia texto o audio por WhatsApp.
2. BuilderBot entrega el mensaje y el historial corto al LLM clasificador.
3. El LLM responde JSON estricto con `kw`, `@ction`, `priority`, `body`, `text`, `query` y `params`.
4. `kw` debe ser exactamente `g0m@s` para que BuilderBot cambie al flujo HTTP.
5. BuilderBot hace `POST /api/v1/webhook/builderbot`.
6. La API identifica al usuario por telefono, consulta su rol actual en MySQL, valida la capacidad requerida y ejecuta el mismo servicio de dominio usado por el dashboard.
7. La API responde siempre `message` y `mensaje`. BuilderBot envia uno de esos campos a WhatsApp.

La implementacion activa es la API serverless bajo `api/v1`. El backend Express historico no es la referencia de produccion.

## Contrato BuilderBot

Ejemplo de entrada:

```json
{
  "kw": "g0m@s",
  "@ction": "CONFIRMAR_MATERIALES_PRODUCCION",
  "priority": "alta",
  "body": "confirmo materiales de OP-20260804-0001",
  "text": "confirmo materiales de OP-20260804-0001",
  "query": "confirmo materiales de OP-20260804-0001",
  "params": {
    "id_orden": "OP-20260804-0001"
  }
}
```

Reglas invariables:

- `body`, `text` y `query` contienen el mensaje real, sin resumir ni corregir.
- Los codigos de producto, lote, OP, factura y despacho se conservan completos.
- Una operacion no se autoriza por lo que diga el JSON: el rol se consulta nuevamente en la base de datos.
- Las respuestas funcionales usan HTTP 200 cuando BuilderBot necesita mostrar el mensaje, incluso si `ok` es `false`.
- No se deben registrar tokens, secretos ni telefonos completos en logs de aplicacion.

## Roles y capacidades

Las capacidades se versionan en `api/_lib/capabilities.js`. El dashboard permite asignar roles, pero no editar permisos arbitrarios.

| Rol | Responsabilidad principal |
| --- | --- |
| `admin` | Sofi: administracion, coordinacion, liberacion de OP y excepciones. |
| `recepcion_cierre` | Nelly: confirmar recepciones y cerrar produccion. Puede aprobar su propia recepcion. |
| `alistador` | Confirmar materiales, inicio y movimientos adicionales/devoluciones de MP. |
| `despacho` | Anderson: consultar facturas Siigo y confirmar salida fisica. |
| `consulta` | Lectura sin operaciones destructivas. |

Los roles heredados `supervisor`, `operario` y `validador` conservan compatibilidad temporal. No deben asignarse a usuarios nuevos.

## Recepcion

Flujo principal:

1. Se registra una orden de compra de proveedor en el dashboard.
2. El importador de Siigo crea una recepcion pendiente a partir de la factura de compra.
3. Nelly vincula OC y factura, cuenta fisicamente y distribuye cada SKU por lote, ubicacion y condicion.
4. Las condiciones admitidas son `DISPONIBLE`, `CUARENTENA`, `RECHAZADO` y `PENDIENTE_DISPOSICION`.
5. Solo `DISPONIBLE` crea stock utilizable y movimiento de entrada.
6. Cuarentena y rechazo permanecen trazables, pero no suman inventario disponible.
7. Se persisten diferencias OC-factura y factura-fisico.

La recepcion manual historica no sustituye este flujo y debe reservarse para contingencias controladas.

## Produccion

### Liberacion

`LIBERAR_ORDEN_PRODUCCION` es ejecutada por `admin`.

Parametros:

- `id_producto_final`
- `cantidad_planificada`
- `origen_tipo`: `OC_CLIENTE` o `STOCK_SEGURIDAD`
- `referencia_cliente` y `cliente_final` cuando el origen es `OC_CLIENTE`

El servicio valida BOM, reserva MP por FEFO y ubicacion, crea la OP en `APROBADA` y genera el picking para el Alistador.

### Confirmacion de materiales

`CONFIRMAR_MATERIALES_PRODUCCION` consume las reservas exactas por lote y ubicacion, registra movimientos y kardex, y cambia la OP a `EN_PROCESO`/`F1`. La operacion es idempotente.

### Ajustes durante proceso

`AJUSTAR_MATERIALES_PRODUCCION` registra `ENTREGA_ADICIONAL` o `DEVOLUCION`. Requiere OP, SKU, lote, codigo visible de ubicacion y cantidad. Una devolucion no puede superar lo consumido desde ese lote y ubicacion.

### Cierre

`CERRAR_ORDEN_PRODUCCION` es ejecutada por `recepcion_cierre`.

Requiere:

- OP en `EN_PROCESO`
- unidades conformes
- merma declarada, incluso si es cero
- motivo cuando la merma es mayor a cero
- ubicacion de producto terminado cuando hay unidades conformes

El servicio crea el lote PT, actualiza stock, registra merma aprobada y devuelve la conciliacion entre consumo teorico, consumo real, devoluciones y entregas adicionales. Repetir el cierre no ejecuta movimientos nuevamente.

## Despacho

La factura de venta de Siigo es el unico origen del despacho normal.

1. `SINCRONIZAR_FACTURAS_SIIGO` ejecuta una consulta manual ademas del polling automatico.
2. La importacion valida cliente, productos, bodega y stock trazable.
3. El WMS reserva por FEFO y crea una tarea `picking` con cliente final, factura, lotes, ubicaciones y cantidades.
4. Si falta cliente o stock, la tarea queda bloqueada y no se puede confirmar.
5. `CONFIRMAR_DESPACHO_SIIGO` descuenta stock solo cuando Anderson confirma la salida fisica.
6. La confirmacion es idempotente y registra movimiento y kardex por lote.

`SOLICITAR_DESPACHO` es un handler heredado y esta bloqueado por defecto con `ALLOW_DIRECT_DISPATCH_REQUEST=false`.

Los despachos parciales tienen estructura de datos y bandera, pero permanecen desactivados. No se debe habilitar `ALLOW_PARTIAL_DISPATCH` hasta completar y probar el ciclo de reservas posteriores contra la misma factura.

## Trazabilidad

`CONSULTAR_TRAZABILIDAD_LOTE` debe poder recorrer:

- OC de proveedor, factura de compra Siigo y recepcion fisica;
- condicion, lote y ubicacion de entrada;
- consumo real por OP y lote de MP;
- lote de producto terminado y conciliacion de produccion;
- factura de venta Siigo, despacho, cantidades y cliente final.

Los movimientos de stock y kardex son evidencia operativa. Los mensajes de WhatsApp no son la fuente de verdad.

## Notificaciones

Las notificaciones nuevas usan `notificaciones_salida` con clave idempotente por evento, canal y destinatario. Los fallos quedan en estado `ERROR` para reintento.

`ENABLE_WORKFLOW_NOTIFICATIONS=false` es el valor seguro inicial. Solo debe cambiarse a `true` despues de asignar correctamente un Admin, un responsable de recepcion/cierre, un Alistador y un responsable de despacho. `DISABLE_OUTBOUND_NOTIFICATIONS=true` anula envios durante pruebas automatizadas.

## Feature flags

Valores seguros por defecto:

```text
ALLOW_PARTIAL_DISPATCH=false
ENABLE_BACKORDER_ALERTS=false
AUTO_RELEASE_STALE_RESERVATIONS=false
RESERVE_AVAILABLE_ON_SHORTAGE=true
REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT=true
ALLOW_SPLIT_PRODUCTION_LINE=false
ALLOW_DIRECT_DISPATCH_REQUEST=false
ENABLE_WORKFLOW_NOTIFICATIONS=false
```

## Compatibilidad heredada

Siguen existiendo acciones `SOLICITAR_INICIO_PRODUCCION`, `SOLICITAR_CIERRE_PRODUCCION`, `SOLICITAR_DESPACHO`, `APROBAR_SOLICITUD` y `RECHAZAR_SOLICITUD` para consultar o completar solicitudes antiguas. No deben aparecer como flujo recomendado en prompts nuevos.

## Pendientes de negocio

- Definir si una OC de proveedor admite varias facturas y recepciones parciales.
- Definir tratamiento final y autorizacion de material en cuarentena.
- Definir tolerancias de diferencias por SKU y umbrales que requieren segunda aprobacion.
- Completar la ejecucion de despachos parciales antes de habilitarla.
- Asignar usuarios reales a los roles y habilitar notificaciones solo despues de una prueba controlada.
