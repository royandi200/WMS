# Plan de pruebas de integracion WMS - SIIGO (septiembre 2026)

Regresion completa de la integracion con SIIGO despues de los cambios de agosto y septiembre (OC operativas en WMS, maquila 3Q, despachos por WhatsApp, identificadores largos) y cierre de los pendientes abiertos en `docs/plan-pruebas-siigo.md` (PT-01 a PT-16, julio 2026).

## Estado de ejecucion

| Bloqueo | Estado |
| --- | --- |
| Credenciales sandbox | **BLOQUEADO.** Las AccessKey de la documentacion `siigoapi.apib` y del correo de Soporte Siigo API (16-jul-2026) responden HTTP 401 el 16-sep-2026. Pendiente: llave vigente de Vercel o de Soporte Siigo. |
| Base de datos QA | Pendiente de credenciales (`DB_*`). |
| WMS objetivo | Pendiente de definir: local contra QA (recomendado) o `https://wms-seven-ebon.vercel.app`. |
| Autorizacion de escrituras en sandbox | Pendiente. |

## Reglas

- Solo sandbox. Ningun nombre, marca, NIT ni SKU real del cliente en SIIGO.
- Prefijo de corrida: `WMSQA2609<NN>` en productos, terceros, lotes, observaciones y numeros de proveedor. `SIIGO_TEST_PREFIX` debe coincidir.
- `SIIGO_STAMP_SEND=false` durante todo el plan. Facturas sin envio DIAN ni correo.
- No suscribir ni modificar webhooks de `sandbox@siigoapi.com`.
- No reintentar POST/PUT ante timeout o respuesta ambigua; verificar primero en SIIGO.
- Linea base antes de cada bloque y conciliacion despues: `stock`, `lots`, reservas, `siigo_sync_log`, `webhook_logs`, cola `retry-sync`.
- Cada documento creado se registra en la tabla de evidencias y se elimina al cierre.
- Ningun secreto en este documento, en logs compartidos ni en Git.

## Configuracion

```env
SIIGO_BASE_URL=https://api.siigo.com
SIIGO_USERNAME=sandbox@siigoapi.com
SIIGO_ACCESS_KEY=<secreto>
SIIGO_PARTNER_ID=<nombre-app-3-a-100-alfanumericos>
SIIGO_TEST_PREFIX=WMSQA2609<NN>
SIIGO_WMS_WAREHOUSE_CODE=BG-PPAL
SIIGO_STAMP_SEND=false
SIIGO_QUOTATION_REFERENCE_PREFIX=WMSCOT
REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT=true
ALLOW_DIRECT_DISPATCH_REQUEST=false
DISABLE_OUTBOUND_NOTIFICATIONS=true
```

Datos de la corrida:

| Entidad | Valor |
| --- | --- |
| Producto MP/insumo | `WMSQA2609NNMP01` |
| Producto IO | `WMSQA2609NNIO01` |
| Producto PT (3Q) | `WMSQA2609NNPT01` |
| Cliente | `WMSQA2609NN Cliente`, ID `9992609NN001` |
| Proveedor | `WMSQA2609NN Proveedor`, ID `9992609NN002` |
| Tercero 3Q (simulado) | `WMSQA2609NN Maquila`, ID `9992609NN003` |
| Lotes | `WMSQA2609NNLOT01`, `...LOT02` (vencimientos distintos para FEFO) |

## Fase 0 - Preflight (sin escrituras)

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| P0-01 | `npm test` | Suite unitaria en verde. |
| P0-02 | `POST /auth` directo con la llave | HTTP 200, `access_token`, `expires_in`. |
| P0-03 | `npm run test:e2e:preflight` | Variables presentes por nombre, DB conectada. |
| P0-04 | `GET /api/v1/health` | `ok=true`, `db=connected`, tablas criticas. |
| P0-05 | Linea base MySQL | Snapshot de stock, lotes, reservas, cursores `invoices_import_cursor` y `purchases_import_cursor`. |

## Fase 1 - Conexion y catalogos (regresion PT-01 a PT-06)

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| C-01 | `GET /api/v1/siigo/health` como Admin | `ok=true`, tipos de documento > 0. |
| C-02 | Health dos veces | Un solo `/auth` en `siigo_sync_log`. |
| C-03 | Vencer `token_expiry` en QA y consultar | Exactamente un `/auth` nuevo. |
| C-04 | Token invalido en `siigo_config` | 401 -> re-login -> un reintento -> exito. |
| C-05 | Health como Operario | 403. |
| C-06 | `POST /api/v1/siigo/sync-document-types` | FV/FC/NC en `siigo_documentos`; registrar IDs por defecto elegidos y validar que corresponden al tipo esperado (el codigo toma el primero activo). |
| C-07 | Crear en SIIGO los tres productos y sincronizar por `codes` | Creados; segunda ejecucion `creados=0`. |
| C-08 | Sincronizar codigo sin prefijo en sandbox | Rechazado. |
| C-09 | Crear terceros y sincronizar por `identifications` | Cliente, proveedor y maquila creados; sin duplicados al repetir. |
| C-10 | Logs | `access_key` y `Authorization` redactados en `siigo_sync_log`. |

## Fase 2 - Compras y recepciones

Contexto vigente: la recepcion normal se hace contra una OC del WMS; la factura de compra SIIGO se vincula despues.

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| R-01 | Crear OC en WMS con proveedor sincronizado y `MP01` x 5 | OC `CARGADA`; sin movimientos. |
| R-02 | Crear OC con proveedor no sincronizado | Rechazada. |
| R-03 | Recepcion fisica parcial 3 de 5 | OC `RECIBIDA_PARCIAL`; stock +3; kardex con `tx_id` unico. |
| R-04 | Recepcion del saldo 2 | OC `CERRADA`; stock total 5. |
| R-05 | FC en SIIGO por 5 `MP01` con referencia de la OC | Polling la importa y la vincula a la OC; no incrementa stock otra vez. |
| R-06 | FC sin OC con `REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT=true` | Queda bloqueada o pendiente con motivo visible; sin stock. |
| R-07 | Importar la misma FC dos veces | `duplicate`; una sola vinculacion. |
| R-08 | FC editada (5 -> 6) despues de recibir | Novedad `FACTURA_MODIFICADA`, una sola vez; sin tocar lotes. |
| R-09 | FC eliminada antes de recibir | Recepcion `anulada`, stock 0. |
| R-10 | Recepcion con faltante, danado y sobrante | Novedades `FALTANTE`/`DANADO`/`SOBRANTE`; solo cantidad aceptada entra a disponible. |
| R-11 | FC con productos de dos bodegas | Bloqueada por bodega multiple. |
| R-12 | FC con bodega SIIGO no mapeada a `BG-PPAL` | Bloqueada con mensaje de bodega no mapeada. |
| R-13 | FC con SKU inexistente en WMS | Bloqueada con motivo SKU. |
| R-14 | Latencia de cron `import-purchases` | Registro de tiempo creacion SIIGO -> WMS (referencia julio: ~77 s). |

## Fase 3 - Ventas y despachos (regresion PT-13, PT-14)

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| V-01 | FV por 2 `MP01` | Despacho `picking`, reserva FEFO 2, stock fisico sin cambio. |
| V-02 | Repetir importacion | `duplicate`; reserva sigue en 2. |
| V-03 | Confirmar despacho | Stock y lote descuentan en una transaccion. |
| V-04 | Confirmar dos veces | `already_completed`; sin doble descuento. |
| V-05 | FV superior al stock | WMS rechaza/bloquea; SIIGO permite sobreventa (conocido). |
| V-06 | FV editada antes de despachar (1 -> 2) | Mismo despacho, reserva reconstruida. |
| V-07 | FV eliminada antes de despachar | Despacho `anulado`, reservas liberadas. |
| V-08 | FV editada despues de despachar | Alerta `FACTURA_MODIFICADA` unica; stock intacto. |
| V-09 | FV anulada (`annulled=true`) | Comportamiento definido y registrado (hoy se omite en polling). |
| V-10 | Nota credito sobre FV despachada | Registrar comportamiento; devolucion exige referencia. |
| V-11 | Numero de FV largo | Numero de despacho legible y unico; sin truncamiento colisionante (pendiente P-006). |
| V-12 | Consultar despachos pendientes por WhatsApp con referencia visible de la FV | Resuelve el despacho correcto sin mutar inventario. |
| V-13 | `ALLOW_DIRECT_DISPATCH_REQUEST=false` | Despacho directo sin FV rechazado. |
| V-14 | Latencia de cron `import-invoices` | Registro de tiempo (referencia julio: 32-156 s). |

## Fase 4 - Cotizaciones y reservas (regresion PT-15 y pendientes)

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| Q-01 | Cotizacion superior al stock | HTTP 409; sin reserva. |
| Q-02 | Cotizacion con stock | Reserva FEFO; repetir devuelve `duplicate`. |
| Q-03 | Conversion exacta a FV con marcador `[WMS-COT:<numero>]` | Reutiliza despacho; sin doble reserva. |
| Q-04 | FV diferente a la cotizacion | Bloqueada; reserva intacta. |
| Q-05 | FV sin referencia pero con misma firma | Bloqueada por referencia omitida. |
| Q-06 | Cotizacion eliminada | Reserva cancelada y liberada. |
| Q-07 | Reserva vencida (> 120 min) con `AUTO_RELEASE_STALE_RESERVATIONS=true` | Liberacion automatica. |
| Q-08 | Cotizacion modificada despues de reservar | Registrar politica aplicada. |

## Fase 5 - Maquila 3Q

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| M-01 | OC `PT01` con tercero maquila | Orden 3Q con reserva FEFO de materiales del BOM. |
| M-02 | Confirmar remision a 3Q | Materiales pasan a custodia 3Q; sin stock disponible. |
| M-03 | Recepcion parcial de `PT01` desde 3Q | `RECIBIDA_PARCIAL`; lote 3Q conservado. |
| M-04 | FC SIIGO del producto 3Q | Se vincula a la OC/orden 3Q; sin doble ingreso. |
| M-05 | Identidad del tercero 3Q | Cruce por identificacion sincronizada (pendiente de dato real). |

## Fase 6 - Robustez, seguridad y operacion

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| S-01 | Rafaga de lecturas hasta 429 | Maximo 2 reintentos en GET; ninguno en POST/PUT. |
| S-02 | Cron sin `CRON_SECRET` | Rechazado. |
| S-03 | Webhook compras/facturas/notas credito sin firma valida | Rechazado o deshabilitado; no muta inventario. |
| S-04 | Webhook productos con secreto incorrecto | 401. |
| S-05 | Replay del mismo webhook | Sin mutacion adicional. |
| S-06 | `webhooks-subscribe` en sandbox compartido | 409. |
| S-07 | Cursores | Avanzan con solapamiento de 5 min; reinicio no reimporta en duplicado. |
| S-08 | `retry-sync` GET/POST | Cola visible y reintento idempotente. |
| S-09 | SIIGO caido (URL invalida en QA) | Error controlado; operacion fisica no se bloquea ni corrompe. |

## Fase 7 - Conciliacion y limpieza

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| K-01 | Stock WMS vs `GET /v1/products` (bodega sandbox) por SKU de la corrida | Iguales o diferencia explicada. Revisar diferencia abierta de 1 unidad (PT-14). |
| K-02 | Duplicados | 0 recepciones, despachos, reservas o alertas duplicadas. |
| K-03 | Cola SIIGO | 0 pendientes. |
| K-04 | Limpieza SIIGO | Eliminar FV, FC, cotizaciones, productos y terceros de la corrida. |
| K-05 | Limpieza WMS | `npm run cleanup:qa` y verificacion de invariantes con `test:e2e:database`. |

## Criterios de aprobacion

- Fases 0 a 3 y 7 aprobadas: requisito para pasar a la cuenta del cliente.
- Fases 4 y 5 aprobadas o con decision funcional documentada.
- Fase 6 sin hallazgos criticos de seguridad.
- Cero datos reales del cliente en sandbox y cero secretos en evidencias.

## Paso a produccion (despues de aprobar)

1. Configurar credenciales del cliente y `SIIGO_PARTNER_ID` en Vercel; redeploy.
2. Borrar `access_token`, `token_expiry` y cursores de `siigo_config`; fijar cursores a la fecha de arranque.
3. Retirar datos QA/sandbox de la base productiva.
4. Sincronizar tipos de documento y confirmar FV/FC correctos con el cliente.
5. Mapear el ID de bodega SIIGO del cliente a `BG-PPAL`.
6. Sincronizar productos y terceros; validar codigos contra catalogo WMS.
7. Prueba controlada: una FC y una FV reales de bajo valor, conciliadas.

## Evidencias

| Caso | Fecha | Documento SIIGO | ID WMS | Saldo antes | Saldo despues | Resultado | Notas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
