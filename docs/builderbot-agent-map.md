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
- Los PDF, BOM, lotes, facturas y movimientos conservan los codigos canonicos completos.
- En conversaciones, un producto puede llegar como SKU o alias humano exacto. La API lo resuelve contra `producto_aliases`, falla ante ambiguedad y registra el producto canonico.
- OC, recepciones, OP y despachos pueden seleccionarse mediante el ID numerico corto que el WMS mostro previamente. El ID no omite permisos ni confirmaciones.
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

1. El PDF crea un borrador mediante `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO`.
2. `REVISAR_BORRADOR_ORDEN_COMPRA` muestra la extraccion sin modificar datos.
3. `CONFIRMAR_BORRADOR_ORDEN_COMPRA` crea la OC operativa solo si no hay advertencias y el mensaje actual contiene la frase de confirmacion con el numero exacto o el ID corto del borrador.
4. `CONSULTAR_RECEPCIONES_PENDIENTES` lista las OC aptas con saldo, número completo e ID corto estable; es de solo lectura.
5. `PREPARAR_RECEPCION_OC` acepta ese ID y crea o reutiliza un borrador con el saldo pendiente por SKU y unidad.
6. Nelly registra todos los productos por cantidad, ubicacion y condicion. Puede usar el SKU o un alias inequivoco. El lote del proveedor es obligatorio solo cuando `productos.requiere_lote = 1`; para los demas es opcional y, si se omite, el WMS crea una partida interna trazable. Si el PDF contiene un lote y vencimiento unicos, el WMS los propone sin pedir que se dicten de nuevo; Nelly debe cotejarlos contra la etiqueta fisica y la confirmacion final deja constancia de esa verificacion.
7. `CONFIRMAR_RECEPCION_OC` usa el borrador `REC-...` cuando el agente lo conserva; con el ID corto de la OC, la API puede resolver el unico borrador activo sin obligar al operario a dictar ese codigo tecnico. Si hay ambiguedad, falla cerrado. Un resumen previo y una confirmacion explicita siguen siendo obligatorios.
8. Solo `DISPONIBLE` crea stock utilizable. Cuarentena, rechazo y disposicion permanecen trazables sin sumar inventario disponible.
9. Una recepcion parcial deja la OC abierta y la siguiente entrega recibe un nuevo `REC-...`. La identidad canonica de la confirmacion impide que un reintento ingrese inventario dos veces.

La factura de compra de Siigo no es requisito para este flujo. `INGRESO_RECEPCION` permanece bloqueado por defecto y no puede omitir la OC.

## Maquila 3Q

El flujo de maquila tercerizada esta implementado inicialmente en API y dashboard:

1. La OC se carga con PDF e items estructurados.
2. Sofi crea una orden `PT`; el WMS reserva el BOM `ENVIO` por FEFO.
3. Una remision en borrador muestra lote y ubicacion interna de origen.
4. Sofi confirma la salida; el material sale del stock local y queda en custodia externa 3Q, sin bodega o ubicacion ficticia.
5. La factura de compra Siigo crea la recepcion pendiente.
6. Nelly vincula cada producto `PT` a su orden 3Q y registra lote, vencimiento, ubicacion WMS y condicion.
7. Las entregas parciales acumulan cantidad disponible hasta completar el objetivo.

El flujo documental separado de BuilderBot acepta dos contratos. `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO` requiere `reception.create` y conserva PDF y extraccion. Una OC consistente puede revisarse y confirmarse despues por WhatsApp; cualquier correccion sigue exigiendo dashboard. `REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO` requiere `outsourcing.manage` y deja una salida 3Q pendiente de revision. Ambos exigen SKU exactos, son idempotentes y no reservan materiales ni ejecutan movimientos de inventario. Los handlers operativos reutilizan los servicios existentes; no se autoriza una ruta documental de mutacion paralela.

Contrato completo: `docs/flujo-orden-compra-y-maquila-3q.md`.

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

### Reposicion para completar unidades conformes

`PREPARAR_REPOSICION_PRODUCCION` es ejecutada por `admin`. Requiere OP, unidades conformes faltantes, motivo y confirmacion explicita de que se repondra el BOM completo. Calcula desde el BOM almacenado en la OP, reserva por FEFO y avisa al Alistador, sin descontar inventario.

`CONFIRMAR_REPOSICION_PRODUCCION` es ejecutada por `alistador`. Consume solo las reservas de esa reposicion, las registra como entrega adicional, conserva la OP `EN_PROCESO` y notifica a `admin` y `recepcion_cierre`. No requiere que el usuario dicte SKU, lote ni ubicacion.

`CANCELAR_REPOSICION_PRODUCCION` permite al `admin` liberar una reposicion aun no confirmada. Una OP con reposicion pendiente no se puede cerrar. Las tres acciones son idempotentes frente a reintentos inmediatos.

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

## Devoluciones de cliente

`GESTION_DEVOLUCION` y el formulario del dashboard usan el mismo servicio transaccional. Toda devolucion nueva requiere:

- factura o despacho ya confirmado;
- referencia externa unica de la devolucion;
- SKU, lote original despachado y cantidad;
- disposicion `RECUPERABLE`, `CUARENTENA` o `DESTRUCCION`.

El cliente se toma del despacho; si el agente lo envia, debe coincidir. La suma de devoluciones de una partida no puede superar su cantidad despachada. Repetir una referencia informa el registro existente y no crea inventario.

`CUARENTENA` y `DESTRUCCION` se ubican en `CUAR-C-1-01` y no quedan disponibles. `RECUPERABLE` exige una ubicacion activa, crea stock disponible y hereda el vencimiento del lote original.

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
