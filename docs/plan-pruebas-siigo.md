# Plan de pruebas - Integracion SIIGO API

Guia para validar la integracion WMS-SIIGO sin contaminar el sandbox compartido ni duplicar documentos contables.

## Reglas de seguridad

- Ejecutar solamente contra la cuenta sandbox hasta aprobar todo el plan.
- Usar el prefijo `WMSQA260721` en productos, terceros, lotes y observaciones.
- No enviar nombres, marcas ni referencias del cliente real a SIIGO sandbox.
- No sincronizar catalogos completos de la cuenta compartida.
- No crear una segunda recepcion o despacho para compensar un error de SIIGO. Usar la cola.
- Reintentar escrituras solo cuando SIIGO haya rechazado explicitamente la operacion, por ejemplo con HTTP 429.
- No reintentar automaticamente POST o PUT ante timeout o respuesta ambigua.
- No modificar webhooks de `sandbox@siigoapi.com`: la suscripcion existente puede pertenecer a otro integrador.
- No guardar credenciales, tokens ni secretos en este documento o en Git.

## Configuracion requerida

Variables de Vercel:

```env
SIIGO_BASE_URL=https://api.siigo.com
SIIGO_USERNAME=<usuario-api>
SIIGO_ACCESS_KEY=<secreto>
SIIGO_PARTNER_ID=<partner-id-asignado>
SIIGO_TEST_PREFIX=WMSQA260721
SIIGO_STAMP_SEND=false
WMS_PUBLIC_URL=https://wms-seven-ebon.vercel.app
SIIGO_WEBHOOK_SECRET=<secreto-aleatorio-de-al-menos-24-caracteres>
```

Despues de modificar variables se debe redesplegar Vercel.

## Datos de prueba aislados

| Entidad | Valor |
| --- | --- |
| Producto | `WMSQA260721P01` |
| Lote | `WMSQA260721LOT01` |
| Cliente | `WMSQA260721 Cliente` |
| Proveedor | `WMSQA260721 Proveedor` |
| Identificacion cliente | `999260721001` |
| Identificacion proveedor | `999260721002` |

Todos deben existir primero en SIIGO y luego sincronizarse selectivamente al WMS.

## PT-01 - Autenticacion y health

1. Iniciar sesion como Admin en el WMS.
2. Ejecutar `GET /api/v1/siigo/health`.
3. Confirmar `ok: true`, token presente y tipos de documento mayores que cero.

Resultado actual: **APROBADO**.

## PT-02 - Reutilizacion del token

1. Consultar dos veces el health.
2. Confirmar en `siigo_sync_log` que no se genero un `/auth` adicional mientras el token seguia vigente.

Resultado actual: **APROBADO**.

## PT-03 - Renovacion del token

1. En un entorno controlado, vencer `token_expiry`.
2. Consultar health.
3. Confirmar un solo `/auth` nuevo y una expiracion futura.

Resultado actual: **APROBADO**.

## PT-04 - Tipos de documento

Ejecutar `POST /api/v1/siigo/sync-document-types` y verificar:

- FV: 255 registros; predeterminado `2372`.
- FC: 31 registros; predeterminado `2377`.
- NC: 53 registros.
- AJ puede no estar disponible en el sandbox y no bloquea FV/FC.

Resultado actual: **APROBADO**.

## PT-05 - Producto selectivo

```http
POST /api/v1/siigo/sync-products
Content-Type: application/json

{"codes":["WMSQA260721P01"]}
```

Repetir la operacion y confirmar `creados: 0`, `actualizados: 1`.

Resultado actual: **APROBADO**. Producto WMS ID 110.

## PT-06 - Terceros selectivos

```http
POST /api/v1/siigo/sync-terceros
Content-Type: application/json

{"identifications":["999260721001","999260721002"]}
```

Confirmar que los nombres contienen `WMSQA260721` y que la segunda ejecucion no duplica registros.

Resultado actual: **APROBADO**. Cliente WMS ID 8; proveedor WMS ID 9.

## PT-07 - Recepcion y factura de compra

Recepcion controlada:

- WMS: `REC-DASH-000002`, ID 33.
- Producto: `WMSQA260721P01`.
- Lote: `WMSQA260721LOT01`.
- Cantidad: 5.
- Precio unitario: 5.000.
- Factura proveedor: prefijo `WQA`, numero `2607210001`.

Validaciones:

- La recepcion queda completada aunque SIIGO falle.
- El lote y `stock` muestran 5 unidades, no 10.
- Un HTTP 429 deja exactamente un `recepcion_siigo` pendiente.
- `POST /api/v1/siigo/retry-sync` procesa la misma recepcion, no crea otra.
- SIIGO devuelve `FC-1-8687`, total 25.000.
- `GET /api/v1/siigo/retry-sync` queda en cero.

Resultado actual: **APROBADO**.

## PT-08 - Despacho y factura de venta

Despacho controlado:

- WMS: `DSP-1784678282822`, ID 33.
- Lote: `WMSQA260721LOT01`.
- Cantidad: 2.
- Precio unitario: 10.000.
- Saldo esperado: 3.

Validaciones:

- `stock.cantidad` y `lots.qty_current` quedan ambos en 3.
- Un HTTP 429 deja exactamente un `despacho_siigo` pendiente.
- El reintento procesa el mismo despacho sin descontar inventario otra vez.
- SIIGO devuelve `FV-1-10000003569`, total 20.000.
- La cola queda en cero.
- CUFE y `stamp_status` deben ser nulos mientras `SIIGO_STAMP_SEND=false`.

Resultado actual: **APROBADO**.

## PT-09 - Cola y observabilidad

`GET /api/v1/siigo/retry-sync` es solo lectura y debe mostrar:

```json
{"ok":true,"data":{"pendientes":0,"detalle":[]}}
```

`POST /api/v1/siigo/retry-sync` procesa hasta cinco referencias. Si alguna falla:

- `ok` debe ser `false`.
- `errores` debe ser mayor que cero.
- El detalle debe incluir status y respuesta estructurada de SIIGO.
- El movimiento debe conservar `siigo_sync=0`.
- El saldo de inventario no debe cambiar durante el reintento contable.

Resultado actual: **APROBADO** para rechazo 429, persistencia y recuperacion posterior.

## PT-10 - Webhook de productos

En la cuenta compartida no se ejecuta `webhooks-subscribe`. El endpoint debe devolver HTTP 409 para impedir reemplazar la URL de otro integrador.

Validaciones disponibles ahora:

- Secreto incorrecto contra `/api/v1/webhook/siigo-products`: HTTP 401.
- Secreto correcto y producto fuera de `WMSQA260721`: HTTP 200 con `ignored: true`.
- El secreto no aparece en logs ni respuestas.

La prueba extremo a extremo queda para credenciales sandbox propias o produccion controlada:

1. Ejecutar una vez `POST /api/v1/siigo/webhooks-subscribe`.
2. Crear un producto con prefijo de prueba en SIIGO.
3. Confirmar su upsert en WMS y `siigo_synced_at` reciente.
4. Repetir el evento y confirmar que actualiza, no duplica.

Resultado actual: **PARCIALMENTE APROBADO**. Receptor y seguridad aprobados; suscripcion externa bloqueada deliberadamente en sandbox compartido.

## PT-11 - Factura de compra primero en SIIGO

Objetivo: comprobar que una factura creada primero en SIIGO genere una recepcion pendiente en WMS sin incorporar stock hasta la llegada fisica.

Datos ejecutados el 22 de julio de 2026:

- Factura SIIGO: `FC-1-8689`, ID `efc3003f-84c9-40b6-914a-f1eea50d6c75`.
- Factura del proveedor: `WQA-2607220001`.
- Producto: `WMSQA260721P01`.
- Cantidad esperada: 2.
- Recepcion WMS: `REC-SIIGO-FC-1-8689`, ID 35.
- Lote fisico: `WMSQA260722LOT01`.

Secuencia y resultados:

1. Se creo la factura directamente mediante `POST /v1/purchases`: SIIGO paso de 3 a 5 unidades.
2. Antes de importar, WMS permanecio en 3 unidades y no tenia una recepcion asociada.
3. `POST /api/v1/siigo/import-purchases` con `purchase_ids` creo un unico borrador con esperado 2 y recibido 0.
4. Repetir la importacion devolvio `duplicate`; no creo otra recepcion.
5. El borrador no incremento stock WMS.
6. `PUT /api/v1/reception` confirmo 2 recibidas, 0 danadas y creo el lote fisico.
7. Repetir la confirmacion devolvio `already_completed`; no duplico lote ni stock.
8. Saldo final conciliado: WMS 5, SIIGO 5.

Resultado actual: **APROBADO** para importacion dirigida, idempotencia y confirmacion fisica sin diferencias.

Pendiente antes de automatizar en produccion:

- Configurar la ejecucion periodica del polling incremental.
- Probar el cursor incremental con una cuenta sandbox exclusiva; en la compartida se exige `purchase_ids` para no consultar documentos ajenos.
- Definir el tratamiento contable de faltantes o unidades danadas, porque la factura ya incremento SIIGO antes de la inspeccion fisica.
- Incorporar en el dashboard la accion para confirmar recepciones en estado `borrador`.

## PT-12 - Polling, cambios y diferencias fisicas

Pruebas ejecutadas el 22 de julio de 2026 con Vercel Pro y frecuencia de dos minutos.

### Hallazgo de la API

`GET /v1/purchases` ignoro en el sandbox los filtros `created_start`, `updated_start` y `date_start`; en los tres casos reporto 7.769 resultados. El polling implementado consulta las paginas mas recientes, compara `metadata.created` con un cursor local solapado cinco minutos y se detiene al alcanzar el cursor. En el sandbox filtra `WQA` antes de importar y no persiste el contenido del listado compartido en logs.

### Polling automatico

- Compra: `FC-1-8690`, ID `4cd370ae-be61-458d-9c0d-360b1d0f860a`.
- Creada en SIIGO: 09:25:01.
- Recepcion creada por cron: 09:26:18.
- Latencia observada: aproximadamente 77 segundos.
- Resultado: una sola recepcion `REC-SIIGO-FC-1-8690`, esperado 2, recibido 0.

Resultado: **APROBADO**.

### Actualizacion antes de recibir

`FC-1-8690` se actualizo en SIIGO de 2 a 3 unidades. El siguiente ciclo actualizo la misma recepcion WMS a esperado 3, sin duplicarla y sin mover stock.

Nota de compatibilidad: para editar la compra, SIIGO exigio conservar `supplier_by_item=false`; enviar `number` fue rechazado por la configuracion de numeracion automatica.

Resultado: **APROBADO**.

### Faltante

- Esperado: 3.
- Recibido y aceptado: 2.
- Stock WMS agregado: 2.
- Novedad: `FALTANTE`, cantidad 1, estado `ABIERTA`.
- La factura se corrigio posteriormente a 2 unidades y el saldo volvio a conciliar.

Resultado: **APROBADO**.

### Danado en recepcion

- Compra: `FC-1-8691`.
- Esperado y recibido fisicamente: 3.
- Danado: 1.
- Aceptado y agregado a stock: 2.
- Novedad: `DANADO`, cantidad 1, estado `ABIERTA`.
- La unidad danada no entro al stock disponible.

Resultado: **APROBADO**.

### Sobrante

- Compra: `FC-1-8692`.
- Esperado: 2.
- Recibido fisicamente: 3.
- Aceptado y agregado a stock: 2.
- Novedad: `SOBRANTE`, cantidad 1, estado `ABIERTA`.
- La unidad adicional no entro al stock disponible.

Resultado: **APROBADO**.

### Eliminacion antes de recibir

- Compra: `FC-1-8693`.
- La factura se elimino en SIIGO mientras la recepcion estaba en borrador.
- El siguiente ciclo cambio `REC-SIIGO-FC-1-8693` a `anulada`.
- Cantidad recibida y stock agregado: 0.

Resultado: **APROBADO**.

### Cambio despues de recibir

La conciliacion de recepciones completadas detecto las correcciones posteriores de `FC-1-8690` y `FC-1-8691`. Creo una novedad `FACTURA_MODIFICADA` por recepcion, no modifico lotes ni stock y la segunda ejecucion devolvio `alert_exists` sin duplicar alertas.

La conciliacion se ejecuta diariamente y tambien puede forzarse con `reconcile_completed=true`.

Resultado: **APROBADO** para cambios. La eliminacion destructiva de una factura ya recibida no se ejecuto para evitar dejar inventario de prueba desbalanceado; el manejo implementado crea `FACTURA_ELIMINADA` sin modificar stock.

### Conciliacion final

- WMS: 11 unidades disponibles.
- SIIGO: 11 unidades en bodega 81.
- Recepciones duplicadas: 0.
- Alertas duplicadas: 0.

Pendientes de interfaz:

- Confirmar recepciones `borrador` desde el dashboard.
- Consultar y resolver `recepcion_novedades`.
- Registrar la decision final sobre faltantes, danados, sobrantes y cambios contables.

## PT-13 - Factura de venta primero en SIIGO

Prueba ejecutada el 22 de julio de 2026 con datos exclusivos `WMSQA`.

Datos:

- Factura SIIGO: `FV-1-10000003576`, ID `2cc451da-784b-4383-929e-07129dda48d5`.
- Producto: `WMSQA260721P01`.
- Cantidad facturada: 2.
- Bodega SIIGO: 81.
- Despacho WMS: `DSP-SIIGO-FV-1-10000003576`, ID 35.
- Lote asignado por FEFO: `WMSQA260721LOT01`.
- Factura sin envio DIAN ni correo y marcada sin validez comercial.

Secuencia y resultados:

1. Antes de facturar, WMS tenia 11 fisicas, 0 reservadas y 11 disponibles.
2. La factura se creo directamente en SIIGO. SIIGO paso a 9 unidades.
3. La importacion creo un despacho en `picking`, sin reducir stock fisico.
4. WMS quedo en 11 fisicas, 2 reservadas y 9 disponibles, conciliado conceptualmente con SIIGO.
5. Repetir la importacion devolvio `duplicate`; la reserva permanecio en 2.
6. La confirmacion del despacho redujo `stock.cantidad` y `lots.qty_current` en la misma transaccion.
7. WMS quedo en 9 fisicas, 0 reservadas y 9 disponibles. El lote quedo con saldo 1.
8. Repetir la confirmacion devolvio `already_completed`; no hubo un segundo descuento.
9. La consulta final de SIIGO reporto 9 unidades totales y 9 en la bodega 81.
10. El endpoint de cron incremental respondio sin errores y tenia cursor actualizado.

Durante la prueba se detecto que el WMS modela `BG-CUAR`, `BG-DEVOL` y `BG-PROD` como bodegas virtuales activas. La bodega contable de SIIGO se mapea exclusivamente a `BG-PPAL`; en sandbox se permite corregir el ID heredado de fixtures. En produccion una discrepancia permanece bloqueada.

Resultado: **APROBADO** para factura primero en SIIGO, importacion manual/automatica, reserva FEFO, confirmacion fisica e idempotencia.

Pendientes antes de produccion:

- Registrar y mostrar facturas bloqueadas por stock insuficiente, SKU, cliente o bodega sin mapear.
- Reconciliar anulaciones y modificaciones de facturas con despachos pendientes o completados.
- Agregar al dashboard la sincronizacion manual, los despachos `picking` y la confirmacion fisica.
- Agregar handlers de WhatsApp para consultar/sincronizar facturas; las excepciones requieren Admin o Supervisor.
- Configurar explicitamente `SIIGO_WMS_WAREHOUSE_CODE=BG-PPAL` y verificar el ID de bodega de la cuenta productiva.

## PT-14 - Excepciones y reconciliacion de ventas

Pruebas ejecutadas el 22 de julio de 2026 sobre el producto `WMSQA260721P01`.

### Venta superior al stock

- Saldo inicial en SIIGO y WMS: 9.
- SIIGO acepto `FV-1-10000003580` por 10 unidades y permitio inventario negativo.
- WMS rechazo la importacion: solicitado 10, disponible trazable 9.
- WMS permanecio en 9 fisicas, 0 reservadas y 9 disponibles.
- La factura de sobreventa se elimino del sandbox.

Resultado: **FALLO EN SIIGO / APROBADO EN WMS**. Con esta configuracion, la garantia de stock no puede depender exclusivamente de SIIGO.

### Importacion automatica

- Factura: `FV-1-10000003581`.
- El filtro remoto `updated_start` devolvio cero resultados aun con una factura dentro de la ventana.
- El fallback de sandbox se ajusto para leer hasta tres paginas recientes, filtrar exclusivamente `WMSQA` y evitar llamadas de detalle redundantes.
- El cron creo automaticamente el despacho 37 en `picking` y reservo 1 unidad.
- Tiempo observado dentro de la ventana final: 32 segundos.

Resultado: **APROBADO**.

### Modificacion antes del despacho

- La factura cambio de 1 a 2 unidades.
- El mismo despacho 37 se actualizo sin duplicarse.
- La reserva anterior se libero y reconstruyo atomicamente.
- Reserva final: 2, distribuida por FEFO entre `WMSQA260721LOT01` y `WMSQA260722LOT01`.
- WMS quedo en 9 fisicas, 2 reservadas y 7 disponibles.

Resultado: **APROBADO**.

### Eliminacion antes del despacho

- La factura se elimino en SIIGO mientras el despacho estaba en `picking`.
- El cron detecto el 404, cambio el despacho a `anulado` y libero ambas reservas.
- WMS regreso a 9 fisicas, 0 reservadas y 9 disponibles.
- Latencia observada con rate limit activo: 156 segundos.

Resultado: **APROBADO**.

### Modificacion despues del despacho

- `FV-1-10000003576`, asociada al despacho completado 35, se cambio temporalmente de 2 a 1 unidad.
- WMS creo una alerta persistente `FACTURA_MODIFICADA`.
- La segunda conciliacion devolvio `alert_exists`; no duplico la alerta.
- WMS no altero stock ni lotes y permanecio en 9.
- La factura se restauro documentalmente a 2 unidades.

Resultado: **APROBADO EN WMS** para deteccion, idempotencia y proteccion del inventario fisico.

Hallazgo pendiente: despues de la secuencia de editar, eliminar y restaurar facturas, SIIGO reporto 10 unidades mientras WMS permanecio en 9. No se aplico un ajuste artificial. La diferencia queda abierta para determinar si es comportamiento del sandbox compartido o una regla del manejo de inventario al editar facturas.

## PT-15 - Prevalidacion de venta mediante cotizacion SIIGO

Prueba ejecutada el 22 de julio de 2026 con cotizaciones exclusivas `WMSQA` y el producto `WMSQA260721P01`.

Saldo inicial WMS: 9 unidades fisicas, 0 reservadas y 9 disponibles.

### Cotizacion superior al stock

- Cotizacion SIIGO: `C-1-12345900`, ID `828f294e-6d9b-40ba-bb3d-03f0494cae9d`.
- Cantidad cotizada: 10.
- SIIGO creo la cotizacion y no modifico inventario, como corresponde a un documento comercial no contable.
- El WMS rechazo la reserva con HTTP 409: solicitado 10, disponible trazable 9.
- El saldo WMS permanecio en 9 fisicas, 0 reservadas y 9 disponibles.

Resultado: **APROBADO**. La garantia de stock la aplico el WMS antes de facturar.

### Cotizacion con stock e idempotencia

- Cotizacion SIIGO: `C-1-12345901`, ID `bc083c62-0056-4f89-85fa-087cfa42d2f0`.
- Cantidad cotizada: 2.
- El WMS creo la reserva `RES-COT-C-1-12345901`, despacho 39 en `picking`.
- FEFO asigno 1 unidad de `WMSQA260721LOT01` y 1 de `WMSQA260722LOT01`.
- El saldo quedo en 9 fisicas, 2 reservadas y 7 disponibles.
- Repetir la validacion devolvio `duplicate`; la reserva no aumento.

Resultado: **APROBADO**.

### Eliminacion y liberacion

- Las dos cotizaciones de prueba se eliminaron del sandbox compartido.
- Reconciliar la cotizacion valida marco la reserva como cancelada, anulo el despacho pendiente y libero 2 unidades.
- Saldo final WMS: 9 fisicas, 0 reservadas y 9 disponibles.

Resultado: **APROBADO**.

Pendientes antes de usar cotizaciones en el flujo comercial:

- Enlazar explicitamente cotizacion y factura para convertir la reserva existente en despacho facturado sin reservar de nuevo.
- Liberar automaticamente reservas vencidas; la vigencia registrada actualmente es de 120 minutos.
- Agregar sincronizacion manual y estado de reserva al dashboard y a WhatsApp.
- Definir si una modificacion de cotizacion conserva la reserva anterior hasta que la nueva cantidad pueda validarse.
- Reducir la interferencia del rate limit usando credenciales propias; la cuenta sandbox compartida produjo multiples respuestas 429 durante la prueba.

## Criterio final

- PT-01 a PT-09 aprobadas.
- PT-11 aprobada para importacion dirigida y confirmacion exacta.
- PT-12 aprobada para polling, cambios previos, diferencias fisicas y eliminacion pendiente.
- PT-13 aprobada para factura de venta primero, reserva y despacho fisico.
- PT-14 aprobada en WMS; SIIGO permite sobreventa y queda pendiente explicar una diferencia contable de 1 unidad tras editar/eliminar facturas.
- PT-15 aprobada para prevalidacion, reserva FEFO, idempotencia y liberacion por eliminacion. La conversion cotizacion a factura sigue pendiente.
- PT-10 completada con una cuenta no compartida.
- Cola SIIGO en cero.
- Inventario WMS conciliado con sus movimientos.
- Ningun dato real del cliente presente en el sandbox.
- `SIIGO_STAMP_SEND` continua en `false` hasta aprobar expresamente facturacion electronica.
