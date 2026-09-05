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
