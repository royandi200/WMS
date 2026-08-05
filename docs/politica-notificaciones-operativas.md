# Politica de notificaciones operativas

Actualizado: 2026-08-04

## Objetivo

Definir quien debe ser informado en cada decision del WMS, por que canal, con que contenido y bajo que condiciones. Esta politica permite ajustar el flujo con el cliente sin modificar reglas de inventario, trazabilidad o autorizacion.

El dashboard y MySQL son la fuente de verdad. WhatsApp es un canal de aviso y accion rapida; una falla de mensajeria no revierte una operacion confirmada ni sustituye el historial del WMS.

## Principios

1. Notificar decisiones y excepciones, no cada escritura tecnica.
2. El actor recibe la respuesta directa y se excluye del envio proactivo equivalente.
3. Los destinatarios se resuelven por rol activo, nunca por numeros escritos en codigo.
4. Cada evento y destinatario tiene una clave idempotente; un reintento no genera un segundo mensaje.
5. Los mensajes usan codigos visibles de OP, OC, factura, lote y ubicacion. No muestran IDs internos ni JSON.
6. Todo envio queda en `notificaciones_salida` con estado, intentos, error y fecha.
7. Las tareas siguen visibles en dashboard aunque WhatsApp falle o nadie responda.
8. `DISABLE_OUTBOUND_NOTIFICATIONS=true` es el corte general de emergencia.

## Roles operativos

| Rol tecnico | Responsable inicial | Alcance de avisos |
| --- | --- | --- |
| `admin` | Sofi; Juan durante QA | Planeacion, excepciones y supervision global |
| `recepcion_cierre` | Nelly; linea rotativa durante QA | Recepciones y cierre de produccion |
| `alistador` | Por asignar; linea rotativa durante QA | Alistamiento FEFO e inicio de produccion |
| `despacho` | Anderson; linea rotativa durante QA | Preparacion y confirmacion de despachos |
| `consulta` | Opcional | Sin avisos operativos por defecto |

Los nombres son asignaciones iniciales, no reglas de codigo. La politica siempre se refiere al rol.

## Matriz maestra

Estados: `ACTIVO` ya existe; `SIGUIENTE` esta aprobado para la proxima implementacion; `CONDICIONAL` requiere regla del cliente; `DASHBOARD` no envia WhatsApp por defecto.

| Dominio | Momento de decision | Evento idempotente | Prioridad | Destinatarios | Fallback | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| Produccion | OP liberada y materiales reservados | `production_released:{op_id}` | Alta | `alistador` | `admin` | ACTIVO |
| Produccion | Materiales confirmados e inicio real | `production_started:{op_id}` | Alta | `admin`, `recepcion_cierre` | `admin` | SIGUIENTE |
| Produccion | Entrega adicional de MP | `production_extra_material:{movement_id}` | Media | Dashboard; `admin` si supera umbral | Ninguno | CONDICIONAL |
| Produccion | Devolucion de MP a bodega | `production_material_returned:{movement_id}` | Media | Dashboard; `admin` si supera umbral | Ninguno | CONDICIONAL |
| Produccion | Merma durante proceso | `production_waste_reported:{waste_id}` | Alta | `admin`, `recepcion_cierre` | `admin` | SIGUIENTE |
| Produccion | OP cerrada | `production_closed:{op_id}` | Alta | `admin` | Ninguno | SIGUIENTE |
| Recepcion | Factura de compra importada y recepcion pendiente | `reception_pending:{reception_id}` | Alta | `recepcion_cierre` | `admin` | ACTIVO |
| Recepcion | Recepcion exacta confirmada | `reception_completed:{reception_id}` | Baja | Dashboard | Ninguno | DASHBOARD |
| Recepcion | Diferencia OC/factura/fisico, cuarentena o rechazo | `reception_exception:{reception_id}` | Alta | `admin` | Ninguno | SIGUIENTE |
| Despacho | Factura sin cliente homologado | `dispatch_pending_customer:{dispatch_id}` | Alta | `admin` | Ninguno | ACTIVO |
| Despacho | Factura con stock insuficiente | `dispatch_shortage:{dispatch_id}` | Alta | `admin`, `despacho` | `admin` | ACTIVO |
| Despacho | Factura lista y picking reservado | `dispatch_ready:{dispatch_id}` | Alta | `despacho` | `admin` | ACTIVO |
| Despacho | Salida fisica confirmada | `dispatch_confirmed:{dispatch_id}` | Alta | `admin` | Ninguno | SIGUIENTE |
| Devolucion | Devolucion registrada | `return_registered:{return_id}` | Alta | `admin` | Ninguno | SIGUIENTE |
| Integracion | Error persistente de Siigo, BBC o polling | `integration_error:{system}:{operation_id}` | Alta | `admin` | Ninguno | CONDICIONAL |

## Contenido minimo por mensaje

### OP liberada -> Alistador

- OP, producto, cantidad planeada y origen.
- BOM, lotes FEFO, cantidades, vencimientos y ubicaciones.
- Accion esperada: confirmar materiales e inicio.

### Produccion iniciada -> Admin y Nelly

- OP, producto, cantidad planeada y origen.
- Persona que confirmo y fecha/hora.
- Materiales consumidos con SKU, cantidad, lote y ubicacion.
- Estado resultante `EN_PROCESO`.
- Nelly queda informada para seguimiento y cierre; no se crea otra aprobacion.

### Merma durante proceso -> Admin y Nelly

- OP, SKU y producto.
- Cantidad, lote, ubicacion y motivo.
- Responsable, fecha/hora y efecto sobre inventario.
- Referencia para consultar el detalle en dashboard.

### Produccion cerrada -> Admin

- OP, producto, plan, conformes y merma.
- Motivo y porcentaje de merma.
- Consumo teorico, consumo neto y variacion por material.
- Lote PT, cantidad disponible, ubicacion y vencimiento.
- Persona que cerro y fecha/hora.
- No incluir el JSON de conciliacion.

### Recepcion pendiente -> Nelly

- OC, factura Siigo, proveedor y fecha.
- Lineas esperadas con SKU y cantidad.
- Accion esperada: comparar factura y fisico, clasificar y ubicar.
- La importacion no aumenta inventario.

### Excepcion de recepcion -> Admin

- OC, factura, proveedor y responsable.
- Diferencias de SKU o cantidad.
- Cantidades disponibles, en cuarentena y rechazadas.
- Lotes, ubicaciones y motivos.

### Despacho listo -> Anderson

- Factura Siigo y cliente final.
- Productos, cantidades, lotes FEFO y ubicaciones.
- Estado de reserva y accion esperada.
- Nunca permitir confirmar si existe faltante.

### Despacho confirmado -> Admin

- Factura, cliente final y comprobante WMS.
- Productos, cantidades y lotes despachados.
- Responsable, fecha/hora y confirmacion del descuento.

### Devolucion -> Admin

- Cliente origen y factura o despacho relacionado.
- Producto, cantidad y lote original cuando exista.
- Disposicion: `RECUPERABLE`, `CUARENTENA` o `DESTRUCCION`.
- Ubicacion y efecto sobre stock disponible.

## Resolucion de destinatarios

1. Consultar usuarios activos de los roles configurados.
2. Excluir cuentas `@wa.bot`, telefonos invalidos y al actor.
3. Eliminar telefonos duplicados.
4. Si no existe destinatario principal, usar los roles de fallback del evento.
5. Si tampoco existe fallback, registrar una excepcion sin inventar un numero.
6. Con varios usuarios en un rol, inicialmente se notifica a todos. Luego puede cambiarse al responsable asignado.

## Idempotencia y reintentos

La identidad de envio es `evento + canal + destinatario`.

- `ENVIADA`: no se vuelve a enviar.
- `PENDIENTE`: no se crea otra fila ni otro envio concurrente.
- `ERROR`: puede reintentarse conservando la misma fila.
- Una OP, recepcion o despacho no depende del resultado de WhatsApp.
- Repetir la operacion de negocio tampoco repite la notificacion.

## Politica de ruido

WhatsApp se usa para tareas asignadas, inicios y cierres importantes, mermas, faltantes, cuarentenas, rechazos, diferencias y errores que requieren intervencion.

Solo dashboard por defecto: consultas, kardex normal, ajustes menores dentro de umbrales, recepciones exactas y reintentos idempotentes sin cambios.

## Parametros modificables

La primera implementacion debe centralizar estas decisiones en un mapa versionado, no dispersarlas en handlers.

| Parametro | Valor inicial | Decision futura |
| --- | --- | --- |
| Evento habilitado | Segun matriz | Activar o desactivar por cliente |
| Roles destinatarios | Segun matriz | Cambiar responsables sin tocar dominio |
| Excluir actor | Si | Mantener salvo solicitud expresa |
| Fallback | `admin` solo donde se indica | Revisar con Sofi |
| Notificar a todos en el rol | Si | Cambiar a responsable asignado si crece el equipo |
| Umbral de merma | Toda merma informa | Definir porcentaje o cantidad por producto |
| Umbral de ajuste MP | Sin WhatsApp por defecto | Definir por cantidad o variacion BOM |
| Horario silencioso | No aplica a eventos criticos | Definir para avisos informativos |
| Acuse obligatorio | No | Evaluar para alistamiento y despacho |

No se construira todavia un editor completo. Cuando las decisiones se estabilicen, el mapa puede migrarse a `notification_policies` y una pantalla administrativa sin cambiar los servicios de dominio.

## Preguntas para el cliente

1. ¿Toda merma debe avisarse o solo cuando supera un porcentaje o cantidad?
2. ¿Nelly necesita cada ajuste de MP o basta con la conciliacion de cierre?
3. ¿Una recepcion exacta debe avisar a Sofi o solo aparecer en dashboard?
4. ¿Sofi quiere todos los despachos o solo excepciones y resumen diario?
5. ¿Habra mas de un alistador o responsable de despacho por turno?
6. ¿Las tareas requieren acuse antes de escalarse?
7. ¿Existen horarios en que solo deben enviarse alertas criticas?
8. ¿Quien reemplaza a Nelly, Sofi o Anderson cuando estan ausentes?
9. ¿Que variacion contra BOM es normal y cual requiere intervencion?
10. ¿Prefieren mensajes individuales o resumen periodico para eventos informativos?

## Pruebas obligatorias

- Destinatario correcto segun rol vigente.
- Actor excluido del envio proactivo equivalente.
- Mensaje sin JSON ni IDs internos.
- Un solo envio al repetir la operacion.
- Registro `ENVIADA` o `ERROR` en `notificaciones_salida`.
- Reintento de `ERROR` sin duplicar fila.
- Operacion confirmada aunque falle WhatsApp.
- Dashboard consistente con el contenido enviado.

## Control de cambios

Toda modificacion debe registrar evento, destinatarios anteriores y nuevos, condicion o umbral, responsable que aprobo, fecha de vigencia y evidencia QA.

Cambiar la politica de avisos no cambia capacidades del rol. Autorizar una accion y notificar una accion son decisiones distintas.
