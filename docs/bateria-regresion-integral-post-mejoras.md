# Bateria de regresion integral post-mejoras

**Version:** 2026-09-05
**Objetivo:** validar que dashboard, WhatsApp y MySQL conserven las mismas reglas de inventario despues de los cambios de integridad, idempotencia y experiencia operativa.

## Reglas de ejecucion

1. Ejecutar solo en ambiente de pruebas y usar referencias con prefijo unico `REG-AAAAMMDD-HHMM`.
2. Tomar antes de cada flujo los saldos de producto, lote, reservas, movimientos y Kardex.
3. Repetir inmediatamente cada accion destructiva. El segundo intento debe devolver el resultado anterior o pedir aclaracion; nunca crear otra mutacion.
4. Probar por ambos canales cuando exista paridad: dashboard y WhatsApp deben llamar al mismo servicio y producir el mismo contrato operativo.
5. No habilitar funciones SIIGO o notificaciones live durante pruebas locales sin autorizacion expresa.
6. Conservar evidencia: mensaje enviado, respuesta completa, captura del dashboard, IDs creados y resultado del auditor MySQL.

## Documentos QA preparados

- `output/pdf/regresion-documental/QA-DOC-20260905-OC-MULTI-001.pdf`: OC con 11 referencias, 10 cantidades en `und`, una en `g`, lotes y vencimientos distintos, proveedor, NIT, moneda y lugar de entrega. Totales de control: `376 und` y `8750 g`.
- `output/pdf/regresion-documental/QA-DOC-20260905-SALIDA-3Q-001.pdf`: salida a 3Q con 9 referencias del BOM de envio, cantidades diferenciadas, destinatario, NIT, direccion, ciudad, responsable y `221 und` en total. Lote y vencimiento se omiten deliberadamente para que los asigne el FEFO del WMS.

Los dos archivos fueron renderizados visualmente y su texto fue reextraido para comprobar referencias y campos de control. Para probar la politica conversacional, usar primero el PDF de OC sin texto y luego reenviarlo con `Orden de compra` en el mismo mensaje.

## Puerta automatizada

Desde la raiz del repositorio:

```powershell
npm.cmd test
Set-Location frontend
npm.cmd run build
Set-Location ..
npm.cmd run test:e2e:database
```

Resultado esperado actual: `195/195` pruebas, build Vite correcto y auditor con `ok: true`, sin stock negativo, reservas invalidas, duplicados documentales ni diferencias lote-stock.

## 1. Recepcion

1. Cargar una OC con PDF y convertir el borrador. Comprobar que desaparece de `PDF recibidos` y permanece como evidencia vinculada.
2. Preparar la recepcion por WhatsApp usando ID corto. Declarar para cada SKU cantidad fisica, lote del proveedor, vencimiento, condicion y ubicacion.
3. Confirmar la misma recepcion desde el canal alterno. Debe existir una sola recepcion, un solo efecto de stock y Kardex consistente.
4. Intentar recibir cantidad disponible superior a la OC. Debe bloquearla o enviarla a una condicion no disponible; nunca incrementar disponible por encima de lo esperado.
5. Verificar historico, fecha Bogota, etiquetas documentales, lote, ubicacion, usuario y diferencias.

## 2. Produccion propia

1. Consultar capacidad por alias. Debe mostrar nombre, SKU, unidad, limitante y faltante exacto sin reducir la cantidad solicitada.
2. Liberar una OP y repetir la misma solicitud dentro de 24 horas. El WMS debe pedir confirmar si es una orden nueva y no reservar dos veces.
3. Confirmar materiales como alistador. El admin recibe estado y responsable; el alistador recibe la accion, nombres, cantidades, unidades, lotes y ubicaciones.
4. Registrar merma de proceso sin inventar referencia tecnica. Repetir el mismo incidente: debe pedir aclarar si es una merma nueva.
5. Preparar reposicion, cancelarla y confirmar que libera reservas y notifica al alistador que la instruccion anterior ya no esta vigente.
6. Preparar otra reposicion y confirmarla. Cerrar la OP con conformes y merma.
7. Intentar cerrar con conformes superiores al plan. Debe fallar cerrado.
8. Probar cero conformes. Debe mostrar `Sin lote conforme` y `No aplica`, no valores `null`.
9. Verificar conciliacion con nombres/unidades, cumplimiento del plan y tasa no conforme como indicadores separados.

## 3. Despacho

1. Usar una factura de prueba importada o fixture controlado. La bandeja debe mostrar solicitado, asignado, reserva activa, despachado, pendiente, lote y ubicacion.
2. Con stock insuficiente, el despacho queda `PENDIENTE_STOCK` y no ofrece confirmacion. El backend tambien debe rechazar un intento directo.
3. Con cobertura completa, confirmar por WhatsApp y revisar el dashboard. Repetir por dashboard: no debe volver a descontar.
4. Importar dos identificadores SIIGO largos con el mismo prefijo. Deben producir numeros de despacho distintos y estables.
5. Abrir la hoja imprimible y comprobar factura, cliente final, SKU, nombre, cantidad, lote, ubicacion y fecha.

## 4. Devoluciones y mermas

1. Registrar devolucion a cuarentena sin referencia tecnica. Debe generar `AUTO-DEV`, conservar motivo y crear entrada fisica positiva con cero disponible.
2. Verificar Buscar producto: `TOTAL FISICO = DISPONIBLE + BLOQUEADO`; la reserva no se suma otra vez.
3. Verificar Kardex del lote devuelto: movimiento `+cantidad`, variacion disponible `0` y saldo del propio lote.
4. Repetir el mismo mensaje y luego confirmar que es una devolucion nueva. Solo la confirmacion explicita permite un segundo evento equivalente.
5. Intentar devolver mas de lo despachado. El mensaje debe indicar despachado, ya devuelto y maximo retornable.
6. Intentar enviar `DESTRUCCION` directamente a la API. Debe rechazarse porque la disposicion final esta deshabilitada; la opcion no debe aparecer en dashboard ni ser propuesta por WhatsApp.
7. Registrar merma de bodega sin referencia. Repetirla y comprobar la misma aclaracion semantica e inventario sin doble descuento.

## 5. Maquila 3Q

1. Enviar el PDF de salida 3Q y comprobar descarga autenticada, hash y ausencia de URL temporal en logs.
2. Preparar remision FEFO. El PDF inicial no exige lote ni vencimiento; el picking del WMS muestra nombre, SKU, unidad, lote y ubicacion.
3. Confirmar salida una vez y repetir. Debe existir un solo descuento y un solo movimiento por material.
4. Vincular OC y registrar una recepcion parcial. Mostrar `enviado`, `PT recibido`, `material pendiente de conciliacion` y `merma reportada`; no inferir consumo proporcional.
5. Completar la recepcion y consultar trazabilidad del lote PT. Debe enlazar recepcion 3Q, orden de maquila, remision, materiales reales enviados, sus lotes/ubicaciones y despachos posteriores.

Caso obligatorio: enviar un PDF sin texto. Debe responder que no fue procesado y pedir reenviarlo con la instruccion en el mismo mensaje. Enviar despues un texto separado no debe recuperar ni vincular el archivo anterior. Al reenviar PDF y texto juntos se crea exactamente un borrador.

## 6. Consultas, aprobaciones y dashboard

1. Consultar un producto por alias exacto y uno ambiguo. El exacto muestra tipo maestro, disponible, bloqueado, ubicaciones y movimientos; el ambiguo ofrece hasta cinco candidatos sin ejecutar acciones.
2. Consultar trazabilidad de lote propio, IO, devuelto y 3Q. Solo aparecen secciones aplicables y todas las cantidades incluyen unidad.
3. Comparar la misma fecha en WhatsApp, recepciones, despachos, devoluciones, mermas, produccion, Kardex y logs. Debe corresponder a `America/Bogota`.
4. Abrir una URL con bundle obsoleto simulado. La app recarga una vez; si persiste, muestra una actualizacion controlada sin bucle.
5. Revisar aprobaciones heredadas. Deben indicar `Flujo anterior`, conservar auditoria y no permitir gestionar ni mutar inventario.
6. Consultar `/api/v1/health`. Solo debe exponer estado general, timestamp y disponibilidad de BD; no tablas, esquema, IDs ni configuracion.

## Criterios de cierre

- Ninguna accion repetida crea un segundo movimiento no autorizado.
- No hay stock negativo, reserva negativa ni reserva superior al stock.
- Todo lote fisico tiene saldo coherente con Kardex; cuarentena y disposicion no suman disponible.
- Dashboard y WhatsApp muestran el mismo resultado de negocio y fecha local.
- Los mensajes identifican responsable, siguiente accion, nombre, SKU, unidad, lote y ubicacion cuando aplican.
- Trazabilidad llega desde el origen documental/material hasta despacho y cliente final sin inventar relaciones.
- La puerta automatizada queda verde despues de las pruebas manuales.

## Registro minimo por prueba

```text
Referencia QA:
Canal y rol:
Accion:
Resultado esperado:
Resultado observado:
IDs creados:
Saldos antes/despues:
Reintento:
Evidencia:
Estado: APROBADA | FALLIDA | BLOQUEADA
```

## Ejecucion manual 2026-09-05

### M01 - Consulta de solicitudes pendientes

- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: `¿Qué solicitudes pendientes hay?`
- Resultado observado: `Solicitudes pendientes: (No hay solicitudes pendientes)`.
- Efecto operativo: solo lectura; no se modifico inventario.
- Estado: APROBADA.
- Siguiente prueba: pendiente de aprobacion del resultado por Juan.

### M02 - Capacidad por alias cotidiano

- Hora Bogota: 13:44.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: `¿Cuántos tarros de ashwagandha 60 puedo producir?`
- Resultado observado: capacidad `2 uds`, limitante `00001-TPBI`; desglose completo con nombres, SKU, unidades, consumo y disponibilidad.
- Estado: APROBADA.

### M03 - Capacidad solicitada insuficiente

- Hora Bogota: 13:45.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: `¿Tenemos capacidad para producir 3 tarros de ashwagandha 60?`
- Resultado observado: indico correctamente que falta `1 und` de `00001-TPBI` y mostro los demas materiales suficientes.
- Estado: APROBADA.

### M04 - Alias generico en consulta de stock

- Hora Bogota: 13:46.
- Canal y rol: WhatsApp, Juan (`admin`).
- Acciones: `¿Cuánto stock hay de tapas?` y `¿Cuánto stock hay de tapas blancas 60?`
- Resultado observado: la primera consulta devolvio `Stock Materia Prima - Top 10: (Sin stock registrado)` y la segunda `Producto no encontrado`, aunque `00001-TPBI` tiene `2 und` disponibles.
- Pendiente: unificar el resolvedor de alias usado por stock con el que ya funciona en capacidad; cuando exista ambiguedad debe ofrecer candidatos, no devolver inventario vacio.
- Estado: FALLIDA.

### M05 - RBAC de consulta administrativa desde alistamiento

- Hora Bogota: 13:47.
- Canal y rol: WhatsApp, Jobana (`alistador`).
- Accion: consultar solicitudes pendientes.
- Resultado observado: acceso negado e identificacion explicita del rol `alistador`.
- Estado: APROBADA.

### M06 - RBAC de consulta administrativa desde despacho

- Hora Bogota: 13:47.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Accion: consultar solicitudes pendientes.
- Resultado observado: acceso negado e identificacion explicita del rol `despacho`.
- Estado: APROBADA.

### M07 - Bandeja de despachos y cobertura parcial

- Hora Bogota: 13:48.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Resultado observado: mostro IDs 52 y 54 como `PENDIENTE_STOCK`, cantidades solicitadas, reservadas y faltantes, lote y ubicacion cuando existian; indico que ninguno podia confirmarse.
- Estado: APROBADA.

### M08 - Bloqueo de despacho parcial

- Hora Bogota: 13:49.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Accion: confirmar despacho ID 52 con `2/100` unidades reservadas.
- Resultado observado: rechazo `La factura aun tiene unidades pendientes de reserva; el despacho parcial esta desactivado`.
- Efecto operativo: sin modificacion de inventario.
- Estado: APROBADA.

### M09 - Despacho completo e idempotencia

- Horas Bogota: consulta 13:50; confirmacion y reintento 13:51.
- Fixture: factura sintetica local `FV-DEMO-REG0905A-PR-001`, sin conexion a Siigo; despacho ID 55.
- Resultado observado: la bandeja mostro `LISTO PARA CONFIRMAR`, producto, lote `LPN-OP-20260902-000068` y ubicacion `C2`; confirmo `1 und`. El reintento informo que ya estaba confirmado y no modifico inventario.
- Verificacion MySQL: estado `despachado`, reserva `0`, una sola fila Kardex `DESPACHO` por `-1`, saldo de lote `2`.
- Estado: APROBADA.

### M10 - Devolucion a cuarentena sin referencia tecnica

- Horas Bogota: envio 13:52; respuesta 13:53.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Resultado observado: creo `DEV-3561875B`, `1 und`, nuevo lote `L-DEV-00102-PTASH60-3561875B`, ubicacion `CUAR-C-1-01`, no disponible.
- Hallazgo: el agente uso incorrectamente la factura `FV-DEMO-REG0905A-PR-001` como `referencia_externa`, aunque el usuario no aporto una referencia documental de devolucion.
- Estado: APROBADA CON HALLAZGO.

### M11 - Reintento semantico de devolucion

- Hora Bogota: 13:53.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Accion: repetir exactamente la devolucion de M10.
- Resultado observado: `La referencia de devolucion ya fue utilizada con datos diferentes`.
- Pendiente: no reutilizar automaticamente la factura como referencia de devolucion; ante repeticion equivalente debe reconocer el duplicado y pedir confirmacion de incidente nuevo. Una referencia de factura no puede impedir devoluciones de otros items de la misma factura.
- Estado: FALLIDA.

### M12 - Liberacion de OP e idempotencia semantica

- Horas Bogota: liberacion 13:55; reintento 13:55.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: producir `1 und` de Ashwagandha 60 para stock de seguridad y repetir la misma solicitud.
- Resultado observado: creo la orden ID 72, `OP-20260905-000072`, interpreto explicitamente `1 und`, mostro el alistamiento FEFO completo y notifico al alistador. El reintento detecto la orden equivalente y pidio confirmacion antes de crear otra.
- Efecto operativo: una sola orden; no hubo una segunda reserva implicita.
- Estado: APROBADA.

### M13 - Confirmacion de materiales e idempotencia

- Horas Bogota: confirmacion y reintento 13:56.
- Canal y rol: WhatsApp, Jobana (`alistador`).
- Accion: `Ya aliste los materiales de la orden 72`, repetida una vez.
- Resultado observado: la OP paso a `EN_PROCESO`; Jobana recibio el detalle consumido y Juan y Datana recibieron la notificacion de inicio con responsable y hora. El reintento indico que los materiales ya estaban confirmados y no modifico inventario.
- Verificacion MySQL: seis movimientos `CONSUMO_MATERIAL` unicos para la OP: tarro, tapa, etiqueta, liner y dos partidas FEFO de gomas (`20 g` y `160 g`).
- Estado: APROBADA.

### M14 - Merma de proceso sin referencia tecnica

- Hora Bogota: 13:57.
- Canal y rol: WhatsApp, Jobana (`alistador`).
- Accion: reportar `10 g` de goma perdidos por derrame en la orden 72.
- Resultado observado: creo `MER-FD5EB8F2` y genero la referencia interna `AUTO-MER-20260905-F3157A02`; vinculo producto, cantidad, motivo y OP.
- Estado: APROBADA.

### M15 - Reintento semantico de merma de proceso

- Hora Bogota: 13:57.
- Canal y rol: WhatsApp, Jobana (`alistador`).
- Accion: repetir exactamente el reporte de M14.
- Resultado observado: reconocio `MER-FD5EB8F2`, no modifico inventario y pidio confirmacion explicita si se trataba de una perdida nueva.
- Estado: APROBADA.

### M16 - Preparacion de reposicion de materiales

- Hora Bogota: 13:58.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: preparar materiales para una unidad adicional de la orden 72 por derrame.
- Resultado observado: creo `REP-OP-000072-0003`, reservo por FEFO tarro, tapa, etiqueta, liner y `180 g` de gomas; notifico a Jobana con nombres, SKU, cantidades, lotes y ubicaciones. La OP permanecio `EN_PROCESO`.
- Estado: APROBADA.

### M17 - Cancelacion de reposicion e idempotencia

- Horas Bogota: cancelacion 14:00; reintento 14:03.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: cancelar `REP-OP-000072-0003` y repetir la cancelacion.
- Resultado observado: cambio a `CANCELADA`, libero las reservas sin descontar inventario y notifico a Jobana que la instruccion anterior ya no estaba vigente. El reintento informo que ya estaba cancelada y no modifico inventario.
- Verificacion MySQL: reposicion `CANCELADA`, `cancelada_en` registrada; las reservas globales de los materiales regresaron al nivel previo.
- Estado: APROBADA.

### M18 - Segunda reposicion y consumo controlado

- Hora Bogota: 14:04.
- Canales y roles: Juan (`admin`) prepara; Jobana (`alistador`) confirma.
- Resultado observado: creo `REP-OP-000072-0004`, notifico a Jobana y, al confirmar, dejo la reposicion `CONFIRMADA`; Juan recibio el detalle entregado y la OP permanecio `EN_PROCESO`.
- Verificacion MySQL: cinco movimientos `CONSUMO_MATERIAL` con referencia propia `reposicion:REP-OP-000072-0004`: `1` tarro, `1` tapa, `1` etiqueta, `1` liner y `180 g` de gomas. No se reutilizo la reposicion cancelada.
- Estado: APROBADA.

### M19 - Cierre con conformes superiores al plan

- Hora Bogota: 14:05.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Accion: intentar cerrar la orden 72 con `3` conformes frente a un plan de `1`.
- Resultado observado: rechazo el cierre porque el excedente no puede ingresar a disponible sin una decision explicita.
- Efecto operativo: sin cierre ni alta de lote.
- Estado: APROBADA.

### M20 - Cierre valido y conciliacion de reposicion

- Hora Bogota: 14:06.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Accion: cerrar la orden 72 con `1` conforme, `0` merma de PT y ubicacion `C2`.
- Resultado observado: cerro la OP, creo `LPN-OP-20260905-000072` con `1 und`, estado `DISPONIBLE`, ubicacion `C2` y vencimiento derivado `2026-09-15`; Juan recibio cumplimiento `100%`, tasa no conforme `0%` y conciliacion completa.
- Verificacion MySQL: una OP `CERRADA`, un lote PT y un unico movimiento `CIERRE_PRODUCCION` por `+1`; la merma de proceso de `10 g` permanece vinculada.
- Hallazgo: una reposicion pedida como `1 unidad adicional` por una perdida de solo `10 g` repuso y consumio el BOM completo. La conciliacion lo transparenta como `+1 und` de cada empaque y `+180 g` de gomas, pero falta una decision de negocio sobre si una perdida parcial debe reponer solo el material perdido o un kit completo.
- Estado: APROBADA CON HALLAZGO.

### M21 - Reintento de cierre desde dos roles

- Hora Bogota: 14:06.
- Canales y roles: Datana (`recepcion_cierre`) y Juan (`admin`).
- Accion: repetir el cierre desde ambos canales.
- Resultado observado: ambos indicaron que la orden ya estaba cerrada por Datana a las 14:06 y no modificaron inventario.
- Estado: APROBADA.

### M22 - Consulta y clasificacion de recepciones pendientes

- Hora Bogota: 14:09.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Resultado observado: listo `7` pendientes separados en `Materia prima e insumos`, `Producto terminado In & Out` y `Producto terminado desde maquila 3Q`; incluyo pendientes, unidades y requisito de lote/vencimiento. El mensaje largo se expandio con `Leer mas` y pudo inspeccionarse completo.
- Estado: APROBADA.

### M23 - Preparacion y declaracion segura de recepcion

- Horas Bogota: preparacion 14:09; declaracion y resumen 14:10.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Fixture existente: OC ID 8, `DEMO-CLIENTE-OC-INSUMOS`.
- Resultado observado: preparo `REC-OC-8-001`, mostro los seis items, ubicaciones sugeridas y exigio cantidad, condicion, lote, vencimiento y ubicacion. La declaracion fisica completa fue interpretada sin perder SKU, unidad, lote, vencimiento ni ubicacion; mostro un resumen y no modifico inventario antes de confirmar.
- Verificacion de flexibilidad: acepto ubicaciones validas diferentes de la sugerida para dos etiquetas (`A1` y `A2`).
- Estado: APROBADA.

### M24 - Confirmacion de recepcion y reintento entre canales

- Horas Bogota: confirmacion 14:11; reintento por admin 14:12.
- Canales y roles: Datana (`recepcion_cierre`) confirma; Juan (`admin`) repite.
- Resultado observado: confirmo `REC-OC-8-001`, ingreso las cantidades exactas de seis items y marco la OC recibida. El reintento de Juan indico que ya habia sido recibida y no modifico inventario.
- Verificacion MySQL: una recepcion `completada`; seis lotes `QA-RX-0905-*`, todos `DISPONIBLE`, con vencimiento `2027-12-31`; seis movimientos `INGRESO_RECEPCION` con referencia `recepcion:REC-OC-8-001`; reservas en cero.
- Estado: APROBADA.

### M25 - Confirmacion conversacional de una OP identica

- Horas Bogota: 14:13 a 14:15.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: solicitar otra OP identica a la 72 y aceptar expresamente crear una nueva produccion.
- Resultado observado: el sistema detecto correctamente el duplicado, pero perdio el producto, la cantidad y el destino durante la confirmacion; volvio a preguntar primero el destino y luego el producto/cantidad. Incluso con `Confirmo una nueva produccion adicional de una unidad... para stock de seguridad` volvio a advertir sobre el duplicado.
- Pendiente: conservar la intencion original en el contexto de confirmacion o emitir una instruccion exacta que realmente sea aceptada. El bloqueo es seguro, pero la conversacion queda en bucle y no permite autorizar una OP repetida legitima.
- Estado: FALLIDA.

### M26 - Cierre con cero conformes

- Horas Bogota: liberacion 14:15; inicio y cierre 14:16.
- Canales y roles: Juan (`admin`), Jobana (`alistador`) y Datana (`recepcion_cierre`).
- Accion: crear y alistar `OP-20260905-000073` por `2 und`; cerrar con `0` conformes y `2` de merma por dano total de empaque, sin indicar ubicacion.
- Resultado observado: cerro sin crear lote PT y mostro `Sin lote conforme`, `Vencimiento: No aplica` y `Ubicacion: No aplica`. Juan recibio cumplimiento `0%`, tasa no conforme `100%`, motivo y conciliacion con nombres, SKU y unidades.
- Estado: APROBADA.

### M27 - Merma de bodega e idempotencia semantica

- Horas Bogota: registro 14:17; reintento 14:18.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Accion: reportar `5 g` de gomas Ashwa del lote `QA-RX-0905-MPASH`, ubicacion `B16`, por derrame durante almacenamiento; repetir el mensaje.
- Resultado observado: genero `MER-4ABBD46A` y referencia `AUTO-MER-20260905-F8AE1553`; el reintento reconocio el incidente y no desconto de nuevo.
- Verificacion MySQL: lote y stock bajaron una sola vez de `2000` a `1995 g`; existe un movimiento `MERMA_BODEGA` por `-5`.
- Hallazgo: el mensaje y `kardex.balance_after` muestran `8540.1`, que corresponde al total disponible del SKU en bodega, no al saldo del lote (`1995`). La trazabilidad por lote debe distinguir explicitamente saldo global de saldo del lote para evitar una lectura incorrecta.
- Estado: APROBADA CON HALLAZGO.

### M28 - Trazabilidad de lote de produccion propia

- Hora Bogota: solicitud 14:19; backend proceso 14:19.
- Canal y rol: WhatsApp, Juan (`admin`).
- Resultado observado: el backend genero una respuesta de `4323` caracteres, superior al limite practico de un mensaje de WhatsApp, y BuilderBot no la entrego al usuario.
- Hallazgos en la respuesta almacenada: repitio varias veces los mismos lotes de material por la reposicion, incluyo una fila de gomas con `neto entregado 0` y `uso productivo estimado -10 g`, y mostro la creacion/cierre a las `9:06 a. m.` cuando ocurrio a las `14:06` Bogota.
- Pendiente: paginar o resumir trazabilidad larga, agrupar materiales sin filas duplicadas, impedir usos productivos negativos y corregir la conversion horaria.
- Estado: FALLIDA.

### M29 - Trazabilidad de producto In & Out

- Hora Bogota: 14:22.
- Canal y rol: WhatsApp, Juan (`admin`).
- Lote: `DEMO-ENSAYO-FINAL-IO-ZENOVA-001`.
- Resultado observado: mostro recepcion, saldo inicial/actual, despacho y cliente, devolucion recuperable y documento de origen. El mensaje fue entregado y pudo expandirse completo.
- Hallazgo: las horas se muestran cinco horas antes de la hora Bogota observada en la operacion original.
- Estado: APROBADA CON HALLAZGO.

### M30 - Trazabilidad de lote devuelto

- Hora Bogota: 14:22.
- Canal y rol: WhatsApp, Juan (`admin`).
- Lote: `L-DEV-00102-PTASH60-3561875B`.
- Resultado observado: mostro origen de factura/despacho/cliente, lote origen, cuarentena, saldo fisico, ubicacion y recepcion documental de devolucion.
- Hallazgos heredados: usa la factura como referencia externa de devolucion y muestra la hora cinco horas antes.
- Estado: APROBADA CON HALLAZGO.

### M31 - Trazabilidad de producto terminado 3Q

- Hora Bogota: 14:23.
- Canal y rol: WhatsApp, Juan (`admin`).
- Lote: `MAN-034-3Q-BOS60-001`.
- Resultado observado: enlazo recepcion 3Q, OC, orden de maquila, remision, materiales enviados con lote/ubicacion, despacho y cliente final.
- Hallazgos: horas desplazadas cinco horas y numero de despacho visible truncado como `DSP-SIIGO-FV-DEMO-MAN038-3Q-`, lo que reduce su capacidad de identificacion humana.
- Estado: APROBADA CON HALLAZGO.

### M32 - Trazabilidad inversa desde material enviado a 3Q

- Hora Bogota: 14:24.
- Canal y rol: WhatsApp, Juan (`admin`).
- Lote: `RECINT-64-95-01` de etiqueta Booster.
- Resultado observado: mostro recepcion de origen y tres remisiones hacia custodia externa 3Q con cantidades y saldos.
- Pendiente: la vista inversa termina en las remisiones y no enlaza los lotes PT recibidos desde 3Q ni sus despachos/clientes finales. La trazabilidad es completa desde PT hacia materiales, pero no desde material hacia PT.
- Hallazgo adicional: horas desplazadas cinco horas; este lote antiguo figura sin vencimiento y como partida interna, contrario a la regla nueva de que toda recepcion requiere lote y vencimiento del proveedor.
- Estado: FALLIDA.

### M33 - Consulta de inventario por SKU exacto

- Hora Bogota: 14:25.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: consultar `00051-MPASH`.
- Resultado observado: mostro nombre, tipo operativo, `8216.25 g` disponibles, ubicacion primaria, lotes, cantidades, vencimientos y alerta de dos lotes vencidos.
- Hallazgos menores: titula la lista `Lotes FIFO` aunque el criterio operativo definido es FEFO; incluye lotes con saldo cero y varias partidas antiguas sin ubicacion, lo que agrega ruido al mensaje.
- Estado: APROBADA CON HALLAZGO.

### M34 - Consulta de inventario con alias ambiguo

- Hora Bogota: 14:25.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: `Consulta el inventario de gomas`.
- Resultado observado: `Producto gomas no encontrado`; no ofrecio candidatos ni pidio precisar el tipo de goma.
- Pendiente: el resolvedor de inventario debe usar alias y desambiguacion, igual que capacidad y acciones operativas.
- Estado: FALLIDA.

### M35 - Busqueda profesional de producto en dashboard

- Hora Bogota: 14:35.
- Canal y rol: dashboard, Juan (`admin`).
- Accion: buscar `00051-MPASH`.
- Resultado observado: mostro nombre y SKU, disponible `8039.25 g`, reservado `100 g`, bloqueado `600.85 g`, total fisico `8640.1 g`, detalle por lote y movimientos recientes; no expuso JSON ni HTML crudo.
- Hallazgo: el movimiento de merma del lote `QA-RX-0905-MPASH` presenta `8540.1 g` como `SALDO DEL LOTE`, aunque el saldo fisico real del lote es `1995 g`; confirma el hallazgo de M27.
- Estado: APROBADA CON HALLAZGO.

### M36 - Busqueda de lote en dashboard

- Hora Bogota: 14:36.
- Canal y rol: dashboard, Juan (`admin`).
- Accion: buscar `QA-RX-0905-MPASH`.
- Resultado observado: ficha compacta con lote, SKU `00051-MPASH`, cantidad `1995`, estado `DISPONIBLE` y vencimiento `2027-12-31`; sin JSON ni datos tecnicos innecesarios.
- Estado: APROBADA.

### M37 - Resumen y stock bajo

- Hora Bogota: 14:37.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: Resumen cargo indicadores y Stock Bajo mostro `00030-ETCG140`, stock `11`, minimo `50`, faltante `39`.
- Hallazgo: el resumen muestra `35` productos con saldo, `74` productos activos y `300` en `Alertas Stock`, mientras la vista Stock Bajo solo lista un SKU. Debe precisarse la semantica de `Alertas Stock` o corregir su agregacion para que sea comparable con el listado.
- Estado: APROBADA CON HALLAZGO.

### M38 - Disposicion final de devoluciones deshabilitada

- Hora Bogota: 14:33.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Accion: solicitar enviar a destruccion `1 und` de Zenova Ashwagandha de `FV-DEMO-IO-001`.
- Resultado observado: rechazo `La disposicion final de devoluciones esta deshabilitada`.
- Verificacion MySQL: la factura mantuvo una sola devolucion previa por `1 und`; no se creo una mutacion nueva.
- Estado: APROBADA.

### M39 - Bloqueo de sobredevolucion

- Hora Bogota: 14:38.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Accion: intentar devolver `2 und` adicionales de Zenova Ashwagandha de `FV-DEMO-IO-001` cuando solo quedaba `1 und` retornable.
- Resultado observado: rechazo indicando `Despachadas: 2`, `Ya devueltas: 1` y `Puedes devolver como maximo: 1 unidad retornable`.
- Estado: APROBADA.

### M40 - Consistencia de historicos operativos

- Horas Bogota: 14:26 a 14:29.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: tras recargar, Recepciones mostro `DEMO-CLIENTE-OC-INSUMOS` como cerrada; Produccion mostro OP 72 y 73 con cantidades, lote y hora; Mermas mostro los eventos recientes de proceso y bodega; Devoluciones mostro `DEV-3561875B`; Despachos mostro la factura fixture, lote, cantidad y hora correctos.
- Hallazgo menor: varias mermas historicas heredadas no tienen tipo visible. Son datos antiguos, no eventos creados por esta ejecucion.
- Estado: APROBADA CON HALLAZGO.

### M41 - Hoja imprimible de despacho

- Hora Bogota: 14:28.
- Canal y rol: dashboard, Juan (`admin`).
- Accion: abrir `Hoja` del despacho de `FV-DEMO-REG0905A-PR-001`.
- Resultado observado: el boton genero una pestaña `blob:` titulada con el numero de despacho.
- Validacion automatizada complementaria: las pruebas del generador verifican factura, cliente, SKU, producto, cantidad, lote, ubicacion, fecha y escape de contenido; CSV permanece implementado pero no visible.
- Bloqueo de evidencia: la politica de automatizacion del navegador impide leer una URL `blob:` ya generada, por lo que la inspeccion visual final de la hoja queda pendiente para una revision humana.
- Estado: BLOQUEADA PARCIALMENTE.

### M42 - Aprobaciones heredadas protegidas

- Hora Bogota: 14:29.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: el historico mostro `50` registros con estado, solicitante, procesador y hora; todos se identifican como `Flujo anterior` y ninguno expone accion `Gestionar`.
- Estado: APROBADA.

### M43 - Mapa de bodega y editor de secciones

- Hora Bogota: 14:29.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: solo aparecen `Bodega Principal`, `Cuarentena` y `Devoluciones`; no aparecen `Otras ubicaciones` ni WIP. `Plano del cliente (77)` conserva `Organizar secciones`. Se abrieron seccion A y ubicacion A1, con asignacion prevista y stock fisico, sin el error de lectura de `name` nulo.
- Estado: APROBADA.

### M44 - Configuracion administrativa de alertas

- Hora Bogota: 14:30.
- Canal y rol: dashboard, Juan (`admin`).
- Accion: cambiar temporalmente `00051-MPASH` de minimo `0` y permanencia `90` a `100` y `120`, guardar y restaurar `0` y `90`.
- Resultado observado: ambos guardados fueron confirmados por la interfaz y el valor restaurado quedo visible. La seccion solo esta disponible para administrador.
- Estado: APROBADA.

### M45 - Alertas de permanencia

- Hora Bogota: 14:31.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: cargo lotes con antiguedad, umbral por SKU, ubicacion y alerta; el valor por defecto visible es `90` dias y no se muestra exportacion CSV.
- Hallazgo: la vista esta contaminada por referencias legacy ajenas al catalogo maestro actual (`PT-VITC`, `RM-GEL` y similares). Aunque el calculo funciona, esos datos reducen la utilidad del tablero para cliente y deben depurarse o excluirse.
- Estado: APROBADA CON HALLAZGO.

### M46 - Total fisico de producto con devolucion bloqueada

- Hora Bogota: 14:39.
- Canal y rol: dashboard, Juan (`admin`).
- Accion: buscar `00102-PTASH60` despues de la devolucion a cuarentena.
- Resultado observado: disponible `157.75`, bloqueado `22.75`, reservado `0` y total fisico `180.5`; se cumple `TOTAL = DISPONIBLE + BLOQUEADO`. El lote `L-DEV-00102-PTASH60-3561875B` aparece con cantidad fisica `1`, estado `CUARENTENA`, disponible `0`, y Kardex `DEVOLUCION +1` con saldo del lote `1`.
- Estado: APROBADA.

### M47 - Consulta de stock por alias inequivoco

- Hora Bogota: 14:42; respuesta 14:43.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: `Consulta el inventario de gomas ashwa`.
- Resultado observado: resolvio `00051-MPASH`, mostro tipo, disponible, ubicacion primaria, lotes y alertas de vencimiento. Confirma que el alias especifico funciona; el defecto de M34 queda limitado al alias ambiguo `gomas`.
- Hallazgos heredados: usa el titulo `Lotes FIFO`, incluye saldos cero y partidas legacy sin ubicacion.
- Estado: APROBADA CON HALLAZGO.

### M48 - Recepcion con sobrante disponible

- Horas Bogota: preparacion y declaracion 14:41; confirmacion 14:42.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Fixture: OC ID 1 con `2 und` pendientes de `00004-TPALB`.
- Accion: declarar `3 und` del lote `QA-OVER-0905-TPALB`, vencimiento `2027-12-31`, ubicacion A1, todas como disponibles; luego confirmar.
- Resultado observado: el resumen conservo el conteo fisico real y no modifico inventario. La confirmacion rechazo que el sobrante ingresara disponible y exigio limitar disponible a lo esperado y clasificar el excedente como `CUARENTENA` o `PENDIENTE_DISPOSICION`.
- Estado: APROBADA.

### M49 - Ajustes directos de materiales y cierre conciliado

- Horas Bogota: OP liberada 14:44; inicio 14:45; entrega adicional 14:45; devolucion 14:46; cierre 14:47.
- Canales y roles: Juan (`admin`), Jobana (`alistador`) y Datana (`recepcion_cierre`).
- Accion: liberar `OP-20260905-000074` por `4 und`; confirmar BOM; entregar `10 g` adicionales de gomas desde `DEMO-GOMAS-001`; devolver `5 g`; intentar devolver `1000 g`; cerrar con `4` conformes y cero merma.
- Resultado observado: la entrega y devolucion validas quedaron vinculadas a la OP, el exceso fue rechazado por superar lo consumido desde ese lote/ubicacion y el cierre creo `LPN-OP-20260905-000074`, `4 und`, C2, vence `2027-12-31`.
- Conciliacion visible: gomas teoricas `720 g`, neto entregado `725 g`, uso productivo estimado `725 g`, variacion `+5 g`; los otros cuatro componentes quedaron en variacion cero.
- Notificaciones: Jobana recibio alistamiento; Juan y Datana recibieron inicio; Juan recibio cierre y conciliacion. No hubo duplicado proactivo al actor.
- Estado: APROBADA.

### M50 - Panel principal y actividad reciente

- Hora Bogota: 14:48.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: cargo KPI de recepciones, mermas, aprobaciones, excepciones y actividad reciente sin error; fechas del dia corresponden a Bogota.
- Hallazgo: el borrador no confirmado `REC-OC-1-002` aparece como `Ultima` recepcion y como actividad reciente `+0 u`. Preparar una recepcion no deberia presentarse como recepcion material ni movimiento operativo consumado.
- Estado: APROBADA CON HALLAZGO.

### M51 - Notificaciones y Webhook Logs

- Hora Bogota: 14:48.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: Notificaciones mostro para OP 74 liberacion a Jobana, inicio a Juan y Datana, y cierre a Juan, todos `ENVIADA`, un intento y horas 14:44-14:47. Webhook Logs mostro pares `RECEIVED`/`PROCESSED` y los rechazos esperados de sobredevolucion, sobre-recepcion y devolucion excesiva de material, con accion, telefono y hora correctos.
- Estado: APROBADA.

### M52 - Acceso invalido

- Hora Bogota: 14:49.
- Canal: API publica de autenticacion.
- Accion: intentar login de `admin@wms.co` con una clave QA incorrecta.
- Resultado observado: HTTP `401`; la sesion valida existente del dashboard siguio operativa.
- Estado: APROBADA.

### M53 - Puerta tecnica posterior a pruebas manuales

- Hora Bogota: 14:40; auditor de BD repetido a las 14:48.
- Resultado observado: `npm.cmd test` aprobo `195/195`; build Vite correcto; `test:e2e:database` devolvio `ok: true` antes y despues de los ultimos intentos, sin stock negativo, reservas invalidas, duplicados documentales ni diferencias lote-stock. La ultima OP cerrada fue la 74 y su lote PT concilia `4/4`.
- Estado: APROBADA.

### M54 - Consulta de ordenes activas y estado puntual

- Horas Bogota: 14:49 y 14:50.
- Canal y rol: WhatsApp, Juan (`admin`).
- Resultado observado: la consulta puntual de orden 74 mostro producto, SKU, estado `CERRADA`, fase F5, planeado `4`, producido `4` y fecha de cierre.
- Hallazgo: la lista de activas devuelve diez OP `PLANEADA` antiguas de julio. Son residuos de pruebas previas y hacen que una consulta operativa actual parezca tener trabajo pendiente real.
- Estado: APROBADA CON HALLAZGO.

### M55 - Confirmacion vaga

- Hora Bogota: 14:50.
- Canal y rol: WhatsApp, Jobana (`alistador`).
- Accion: enviar solo `Listo` despues de cerrar la OP 74.
- Resultado observado: no ejecuto ninguna mutacion y pregunto que accion deseaba realizar.
- Hallazgo menor: arrastro la orden 74 ya cerrada como contexto; es seguro, pero conviene evitar sugerir una orden terminada ante mensajes vagos.
- Estado: APROBADA CON HALLAZGO.

### M56 - Correccion de SKU en el siguiente mensaje

- Hora Bogota: 14:50.
- Canal y rol: WhatsApp, Juan (`admin`).
- Accion: consultar `00051-MPASHH` y corregir con `Quise decir 00051-MPASH`.
- Resultado observado: rechazo el SKU inexistente y la correccion posterior recupero correctamente la consulta de `00051-MPASH`, sin exigir repetir toda la frase.
- Estado: APROBADA.

### M57 - Filtro de tipo en catalogo de productos

- Hora Bogota: 14:51.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: el selector contiene `Todos`, `Producto terminado`, `Materia prima`, `Empaque`, `Insumo` y `Otro`. Al seleccionar `Producto terminado` mostro `7 productos` filtrados de `50`, todos con el tipo correcto.
- Estado: APROBADA.

### M58 - Usuarios, maquila y Kardex

- Hora Bogota: 14:51.
- Canal y rol: dashboard, Juan (`admin`).
- Resultado observado: Usuarios cargo los roles operativos configurables; Maquila 3Q mostro ordenes pendientes, completadas, canceladas y material pendiente de conciliacion; Kardex mostro en secuencia OP 74, consumo inicial `-720 g`, entrega adicional `-10 g`, retorno `+5 g` y cierre `+4 und`, con referencias y horas Bogota.
- Hallazgo de datos: Usuarios y Maquila conservan registros historicos de pruebas, por lo que se requiere una depuracion controlada antes de una presentacion como entorno limpio de cliente.
- Estado: APROBADA CON HALLAZGO.

### M59 - Despacho directo sin factura

- Hora Bogota: 14:52.
- Canal y rol: WhatsApp, Datana (`despacho`).
- Accion: solicitar despachar `1 und` de Zenova Ashwagandha para Cliente QA sin factura ni tarea importada.
- Resultado observado: rechazo la salida y exigio factura Siigo o tarea de despacho importada; no modifico inventario.
- Estado: APROBADA.

### M60 - Salud publica del despliegue

- Hora Bogota: 14:53.
- Canal: endpoint publico `/api/v1/health`.
- Resultado observado: HTTP exitoso con `ok`, estado general y timestamp; no expuso tablas, esquema, IDs, credenciales ni configuracion interna.
- Observacion: la respuesta deliberadamente minima no distingue en un campo separado la disponibilidad de MySQL. La salud de datos se valido por la puerta autenticada `test:e2e:database`.
- Estado: APROBADA.

### M61 - PDF sin texto y texto posterior separado

- Horas Bogota: PDF 15:24; respuesta tardia 15:25; texto separado 15:25; respuesta 15:26.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Documento: `QA-DOC-20260905-OC-MULTI-001.pdf`, enviado sin descripcion.
- Resultado observado: no se creo webhook, borrador documental ni OC en WMS. Sin embargo, BuilderBot respondio `Auth no configurada`, en vez de ignorar el archivo o explicar que debe reenviarse con la instruccion en el mismo mensaje.
- Segundo paso: se envio `Orden de compra` como mensaje separado. No recupero ni vinculo el PDF anterior; pidio numero de OC o ID de borrador.
- Verificacion dashboard: la referencia `QA-DOC-20260905-OC-MULTI-001` no aparece en `PDF recibidos por WhatsApp` ni en ordenes esperadas.
- Pendiente: mover la validacion de texto adjunto antes de cualquier rama de autenticacion/documento en BuilderBot y responder una instruccion clara, sin `Auth no configurada`.
- Estado: FALLIDA PARCIALMENTE; la separacion de contexto fue segura y no hubo mutacion.

### M62 - PDF valido con instruccion adjunta

- Hora Bogota: 15:28.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Documento: `QA-DOC-20260905-OC-MULTI-001.pdf`, reenviado con la descripcion `Orden de compra para recepcion de mercancia` en el mismo mensaje.
- Resultado esperado: clasificar el documento, registrar un unico borrador de OC con 11 referencias y conservar el inventario sin cambios hasta la revision humana.
- Resultado observado: BuilderBot respondio `Auth no configurada`; no se creo webhook, borrador documental ni OC en WMS.
- Verificacion corregida: la llamada si alcanzo el webhook WMS, pero el nodo HTTP `Salida` no enviaba encabezado de autenticacion y el `aiResponse` documental no aporto un `kw` interpretable. El webhook respondio de forma controlada antes de ejecutar cualquier handler.
- Pendiente: repetir la carga valida despues de asegurar la autenticacion del nodo HTTP compartido.
- Estado: BLOQUEADA.

### M63 - Recuperacion de BuilderBot y autenticacion documental

- Horas Bogota: diagnostico 15:45-15:49; prueba de control 15:50.
- Canal: BuilderBot Cloud y WhatsApp, Datana (`recepcion_cierre`).
- Diagnostico: el flujo `Documentos de Bodega` conserva el asistente PDF y enruta al nodo HTTP `Salida`. Ese nodo enviaba `info`, `from`, `document_url` y `document_text`, sin encabezado de autenticacion ni `kw` fijo.
- Ajuste: se agrego `kw: g0m@s` al cuerpo HTTP compartido, preservando el resto de la configuracion, y se reinicio el bot.
- Verificacion: lectura posterior confirmo el nuevo campo; BuilderBot paso a `ONLINE`; la consulta inocua `¿Que recepciones pendientes hay?` fue leida y respondida correctamente a las 15:50. No modifico inventario.
- Observacion operativa: el PDF que el usuario creyo reenviar quedo en el chat personal `Yo`, no en el chat del agente `Staging`; por eso aun falta repetir M62 contra el destinatario correcto.
- Estado: RECUPERACION APROBADA; REPETICION DOCUMENTAL PENDIENTE.

### M64 - Limite de longitud en extraccion documental

- Hora Bogota: 15:54; diagnostico y correccion 16:00-16:06.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Documento: `QA-DOC-20260905-OC-MULTI-001.pdf`, con 11 referencias y texto adjunto.
- Resultado observado: el asistente identifico correctamente `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO`, pero BuilderBot corto `aiResponse` en 5.134 caracteres. El JSON termino dentro de una cadena y el webhook, al no poder parsearlo, lo clasifico como `UNKNOWN`; respondio `Accion desconocida: UNKNOWN` y no modifico inventario.
- Causa: limite de salida no cubierto por los documentos mas pequenos de la bateria anterior; no corresponde a una perdida del handler WMS.
- Primer ajuste: JSON obligatorio en una sola linea y menor a 4.000 caracteres, omision de campos opcionales vacios y descripciones de hasta 60 caracteres. La repeticion de las 16:08 siguio fallando: BuilderBot entrego 5.119 caracteres y corto el JSON durante el tercer item.
- Causa raiz completada: en el asistente documental, `{body}` se resolvio como el OCR completo y fue copiado dentro de `aiResponse`; no era la leyenda corta adjunta al PDF. Pedir brevedad no eliminaba esa duplicacion estructural.
- Ajuste definitivo aplicado: `aiResponse` solo contiene `kw`, `@ction`, `priority` y `params`. El nodo HTTP transporta por separado `body`, `text`, `query`, `document_text` y `document_url`, manteniendo la validacion del mensaje adjunto y la evidencia fuera del JSON generado.
- Verificacion tecnica: bot `ONLINE`; nodo HTTP conserva `kw: g0m@s` y los ocho campos esperados; falta una repeticion final para medir el JSON completo y comprobar las 11 referencias.
- Estado: CORREGIDA ESTRUCTURALMENTE; REPETICION DOCUMENTAL PENDIENTE.

### M65 - Repeticion final de OC documental multireferencia

- Hora Bogota: 16:20.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`).
- Resultado observado: webhook `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO` procesado; se creo exactamente un borrador `BUILDERBOT`, ID 7, con 11 items y una copia del PDF. No se creo OC operativa y no existe movimiento Kardex asociado.
- Extraccion correcta: los 11 SKU y sus cantidades/unidades quedaron registrados.
- Hallazgo de unidades: el borrador quedo `REQUIERE_CORRECCION` porque `total_calculado` sumo `376 und + 8750 g = 9126`; magnitudes de unidades distintas no deben agregarse en un unico total.
- Hallazgo OCR: faltaron los vencimientos de `00001-TPBI` y `00018-ETBOS60`, y lote/vencimiento de `00042-CMCG`. El estado de correccion evita convertir esos datos incompletos en una OC operativa sin revision humana.
- Estado: APROBADA CON HALLAZGOS; transporte y seguridad correctos, validacion semantica multunidad y tres campos OCR pendientes.

### M66 - Politica sin texto, idempotencia y revision visual de OC

- Hora Bogota: 16:26-16:27.
- Canal y rol: WhatsApp y dashboard, Datana (`recepcion_cierre`) y Juan (`admin`).
- PDF sin texto adjunto: FALLIDA. BuilderBot lo proceso como duplicado y devolvio `ya estaba registrada`; debio rechazarlo indicando que faltaba la instruccion en el mismo mensaje. No creo otro borrador ni modifico inventario.
- PDF reenviado con texto adjunto: APROBADA. Respondio que la orden ya existia y no la duplico.
- Dashboard: APROBADO CON HALLAZGOS. Muestra una unica fila, PDF descargable, 11 SKU y cantidades/unidades correctas (`8.750 g + 376 und`). Conserva diez lotes, pero omite el lote `QA-CMCG-260905`; omite los vencimientos `2028-01-31`, `2028-05-31` y `2028-09-30` de `00001-TPBI`, `00018-ETBOS60` y `00042-CMCG`.
- Hallazgo de validacion: la advertencia `376 no coincide con 9126` suma gramos y unidades. Debe comparar totales por unidad, no magnitudes incompatibles.
- Estado: APROBADA PARCIALMENTE; idempotencia y presentacion correctas, politica sin texto y exactitud documental pendientes.

### M67 - Correccion posterior a OC multireferencia

- Hora Bogota: 16:41.
- Alcance: validacion local del WMS y sincronizacion del asistente documental de BuilderBot.
- Total multunidad: se corrigio el calculo para agrupar unidades equivalentes (`und`, `unidades`; `g`, `gr`; `kg`) y evitar sumar magnitudes incompatibles. Para el caso probado, `376 und + 8750 g` se compara como `376 und`, no como `9126`.
- Cobertura: se agregaron pruebas para mezcla de unidades, discrepancia contra el subtotal comparable y rechazo de un subtotal en gramos presentado como total de unidades. La suite completa local paso: `198` pruebas, `0` fallas.
- Extraccion documental: el prompt ahora permite asociacion posicional solo cuando los bloques OCR de SKU, cantidad, lote y vencimiento tienen conteos compatibles y orden inequivoco. Tambien exige contar los lotes y vencimientos visibles antes de responder.
- BuilderBot: prompt sincronizado, topologia preservada, contrato HTTP corto conservado y bot verificado `En linea`.
- Texto adjunto: la prueba demostro que el adaptador Meta actual no expone de forma confiable el caption de documentos. No es posible rechazar automaticamente solo los PDF sin texto sin bloquear tambien los PDF validos. Se conserva como barrera efectiva que cualquier PDF solo cree un borrador revisable y nunca modifique inventario.
- Revision de seguridad: sin cambios de autenticacion o permisos, sin secretos nuevos, sin escritura de inventario desde lectura documental y sin diferencias en `docs/agent-dashboard-qa-plan.md`.
- Despliegue: el prompt de BuilderBot esta activo. El ajuste de calculo del WMS permanece local, sin push ni despliegue a Vercel.
- Estado: CORREGIDA LOCALMENTE; REPETICION DOCUMENTAL CON REFERENCIA NUEVA PENDIENTE DESPUES DEL DESPLIEGUE WMS.

### M68 - Enrutamiento documental por marcador visible

- Regla: `ORDEN DE COMPRA` dirige el borrador a Recepciones; `SALIDA DE BODEGA HACIA 3Q` o `REMISION A 3Q` lo dirige a Maquila 3Q.
- Defensa en profundidad: el asistente clasifica y la API valida nuevamente el marcador literal en el OCR. El nombre del archivo, caption, proveedor y productos no determinan el tipo.
- Fallo cerrado: un documento sin marcador o con marcadores de ambos tipos se rechaza y no crea un borrador mal ubicado.
- Inventario: ninguna lectura documental reserva, ingresa, descuenta ni mueve existencias.
- Pruebas: encabezados correctos, marcador ausente, marcador alternativo de remision y conflicto entre tipos. Suite local: `200` pruebas, `0` fallas.
- Despliegue: prompt de BuilderBot sincronizado y bot verificado `En linea`. Backend local, sin push ni despliegue.
- Estado: APROBADA LOCALMENTE.

### M69 - OC documental R02 multireferencia en entorno desplegado

- Hora Bogota: 17:09.
- Canal y rol: WhatsApp, Datana (`recepcion_cierre`), con verificacion en base de datos y dashboard.
- Documento: `QA-DOC-20260905-R02-01-OC-VALIDA.pdf`.
- Enrutamiento: se clasifico como `ORDEN_COMPRA` y creo exactamente un borrador BuilderBot, ID 8, con referencia `QA-DOC-20260905-R02-OC-MULTI-001`, una copia documental y estado `REQUIERE_CORRECCION`.
- Extraccion: registro los 11 SKU y todas sus cantidades/unidades. El total quedo correctamente separado como `8.750 g + 376 und`; en base, `total_unidades` y el subtotal comparable son `376`, sin sumar gramos y unidades.
- Seguridad operativa: no creo una OC operativa, no genero movimientos Kardex y no modifico inventario.
- Dashboard: muestra la referencia nueva en `PDF recibidos por WhatsApp`, 11 items, los totales separados, fecha y PDF descargable.
- Hallazgo OCR: `00018-ETBOS60` perdio el vencimiento; `00042-CMCG` perdio lote y vencimiento. Los otros nueve items conservaron lote y vencimiento. El estado de correccion y la revision humana impiden confirmar silenciosamente datos incompletos.
- Hallazgo de catalogo: el proveedor extraido no coincide de forma inequivoca con un proveedor sincronizado, por lo que requiere seleccion humana.
- Estado: APROBADA CON HALLAZGOS; enrutamiento, unidades, persistencia e invariantes de inventario correctos, precision OCR pendiente en tres campos.

### M70 - Remision documental R02 hacia 3Q

- Hora Bogota: 17:16.
- Canal y rol: WhatsApp, Juan (`admin`), con verificacion en base de datos y dashboard.
- Documento: `QA-DOC-20260905-R02-02-REMISION-3Q-VALIDA.pdf`.
- Enrutamiento: se clasifico como `SALIDA_BODEGA_3Q` y creo exactamente un borrador BuilderBot, ID 9, con referencia `QA-DOC-20260905-R02-SALIDA-3Q-001`, una copia documental y estado `REQUIERE_CORRECCION`.
- Extraccion: registro correctamente los 9 SKU y sus cantidades; total declarado y calculado `221`.
- Dashboard: el documento aparece en `Maquila 3Q > Documentos leidos`, con destinatario 3Q, fecha, 9 lineas vinculadas al catalogo WMS y PDF original descargable. Permanece sin remision operativa vinculada.
- Seguridad operativa: no creo una remision, no genero movimientos Kardex y no modifico inventario.
- Hallazgo de persistencia: la columna `unidad` de las nueve lineas quedo nula, aunque el PDF declara `und`, el total se presenta como unidades y las cantidades son correctas. Debe preservarse la unidad explicita antes de automatizar la conversion del borrador.
- Observacion esperada: el estado de correccion se debe unicamente a la leyenda de documento de demostracion sin validez comercial.
- Estado: APROBADA CON HALLAZGO; clasificacion, extraccion de referencias, aislamiento y ubicacion en dashboard correctos, unidad de linea pendiente.

### M71 - Documento sin marcador operativo

- Hora Bogota: 17:21.
- Canal y rol: WhatsApp, Juan (`admin`), con verificacion en base de datos.
- Documento: `QA-DOC-20260905-R02-03-SIN-MARCADOR.pdf`.
- Resultado: rechazo explicito porque el PDF no contiene `ORDEN DE COMPRA` ni `SALIDA DE BODEGA HACIA 3Q`; la respuesta indica los encabezados admitidos y exige referencias, SKU y cantidades legibles.
- Fallo cerrado: no se creo ningun borrador para `QA-DOC-20260905-R02-SIN-MARCADOR-001`, no se persistieron items y no hubo movimientos Kardex.
- Estado: APROBADA.

### M72 - Documento con marcadores contradictorios

- Hora Bogota: 17:24.
- Canal y rol: WhatsApp, Juan (`admin`), con verificacion en base de datos.
- Documento: `QA-DOC-20260905-R02-04-MARCADORES-CONTRADICTORIOS.pdf`.
- Resultado: rechazo controlado; el documento no fue clasificado como OC ni como salida hacia 3Q.
- Fallo cerrado: no se creo ningun borrador para `QA-DOC-20260905-R02-CONFLICTO-001`, no se persistieron items y no hubo movimientos Kardex.
- Hallazgo menor de experiencia: la respuesta utiliza el mismo texto que el caso sin marcador y no explica que encontro ambos encabezados. La seguridad es correcta, pero un mensaje especifico reduciria reprocesos del usuario.
- Estado: APROBADA CON HALLAZGO MENOR.

### M73 - Correccion de hallazgos documentales R02

- Hora Bogota: 17:35.
- Recuperacion OCR: se agrego una lectura determinista de bloques delimitados por SKU exacto. Solo completa unidad, lote o vencimiento cuando existe una unica ocurrencia del SKU, una cantidad coincidente y un valor inequivoco dentro de la misma fila aplanada.
- Maquila 3Q: la unidad ahora forma parte del modelo normalizado, el `INSERT`, la comparacion idempotente y la presentacion del dashboard.
- Mensajeria: BuilderBot diferencia marcadores contradictorios de marcador ausente y solicita corregir el PDF sin afirmar que creo un borrador.
- Compatibilidad: los borradores 3Q historicos sin unidad mantienen reintentos equivalentes como `und`; un cambio real de unidad forma una identidad operativa distinta.
- Verificacion: pruebas documentales `30/30`, suite completa `203/203`, build Vite aprobado, prompt sincronizado por lectura posterior, topologia preservada y bot `ONLINE`.
- Estado: IMPLEMENTADA; repeticion manual R03 pendiente tras despliegue del backend.
