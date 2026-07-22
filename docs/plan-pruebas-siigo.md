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

## Criterio final

- PT-01 a PT-09 aprobadas.
- PT-10 completada con una cuenta no compartida.
- Cola SIIGO en cero.
- Inventario WMS conciliado con sus movimientos.
- Ningun dato real del cliente presente en el sandbox.
- `SIIGO_STAMP_SEND` continua en `false` hasta aprobar expresamente facturacion electronica.
