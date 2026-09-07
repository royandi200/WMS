# Recepcion mixta: mismo lote proveedor, distintas condiciones

Fecha: 2026-09-06, America/Bogota. Corte de implementacion local: 22:09.
Base de implementacion: 2b7edc7. El corte de las secciones siguientes describe las pruebas locales.

## Actualizacion 22:15: preparacion de validacion WhatsApp

Juan autorizo realizar esta validacion por WhatsApp. Aplicada migracion31 de forma
aditiva; consulta de trazabilidad verificada mediante SELECT contra MySQL real.
Suite repetida 323/323 y build correcto. Publicacion y prueba en curso.
Roles leidos: Juan admin; Datana recepcion_cierre; Jobana alistador. Sin cambios.
OC6 CARGADA, recepcion61 borrador. Base: kardex358, movimientos359, lots159,
distribuciones42, stock de Zenova36.5. Lote QA-PREVIEW-20260906-IO inexistente.

## Decision y alcance

- Un mismo SKU/lote proveedor puede recibirse disponible, en cuarentena y rechazado.
- Se conservan lote fisico, vencimiento, cantidad, ubicacion, condicion y motivo. No se inventa otro lote proveedor.
- Solo DISPONIBLE entra en stock y movimientos de entrada disponible.
- Cada condicion bloqueada recibe una partida interna RECBLK determinista por recepcion/item/lote/condicion. Varias ubicaciones de la misma condicion comparten partida, pero conservan sus distribuciones.
- `recepcion_distribuciones.lote` sigue siendo la identidad interna usada por lots/kardex. La nueva columna `lote_proveedor` conserva la etiqueta fisica original, tambien en las distribuciones disponibles.
- El lote disponible conserva el codigo proveedor para no cambiar picking, reservas, produccion o despachos existentes.
- Cada distribucion bloqueada tiene Kardex de ingreso fisico bloqueado, sin crear disponible. Rechazado NO significa destruido y no se habilita disposicion.
- Las recepciones historicas no se reescriben. Se interpretan con COALESCE(lote_proveedor, lote).

## Correcciones

1. Eliminado el rechazo de condiciones distintas para el mismo lote. En cambio se rechazan vencimientos distintos para el mismo lote dentro del item.
2. Resumen WhatsApp y confirmacion comparten validaciones de cantidades, sumas, motivo, lote, vencimiento y limite disponible de la OC. La ubicacion del resumen se restringe a la bodega de recepcion.
3. La confirmacion mantiene transaccion, bloqueo de recepcion, control de duplicados, conciliacion y validacion final de ubicaciones activas y procedencia de lotes existentes.
4. Historico de recepciones muestra lote proveedor y partida interna separadamente.
5. Buscar lote y trazabilidad WhatsApp relacionan las partidas desde el lote proveedor o una partida interna. Las cantidades de la tabla son RECIBIDAS, no saldos disponibles actuales. Saldo e historial principal corresponden a la partida seleccionada.
6. Sin cambios en PDF, prompt BBC, modelos, permisos, Siigo ni logica de destruccion.

## Evidencia interna

Pruebas automatizadas de codigo real con conexiones simuladas, no confirmaciones en SQL vivo:

- Reparto 5 = 3 disponible + 1 cuarentena + 1 rechazado: tres lots, un unico stock de 3, tres entradas Kardex y proveedor conservado.
- OC de 5 mantiene saldo de 2 segun la regla existente de cantidades aceptadas.
- Repeticion: devuelve already_completed; no agrega escrituras ni inventario.
- Fallo de persistencia: rollback de lotes, stock, distribuciones y cierre.
- Recepciones de una sola condicion y cuarentena en dos ubicaciones: saldos fisicos correctos.
- Mismo lote con fecha incompatible, ubicacion de otra bodega, cantidades/condiciones invalidas, ausencia de motivo/lote/vencimiento/ubicacion: rechazo.
- Partidas deterministas aunque se reordenen distribuciones; recepciones distintas tienen partidas bloqueadas distintas.
- GET de lote relaciona 3/1/1; consultas ambiguas por producto/bodega fallan sin escoger arbitrariamente.
- Migracion: dry-run sin escritura, aplicacion explicita, repeticion sin segundo ALTER.
- Copia local de la vista previa real REC-OC-6-001: recibido 5, disponible 3, cuarentena 1, rechazado 1; un lote proveedor, tres identidades internas. Cero escrituras.
- UI aislada con datos sinteticos: 1440x1000 y 390x844, sin errores de pagina ni solicitudes externas. Se inspeccionaron capturas de Buscar Lote.
- Suite completa repetida a las 22:09: 323/323, cero fallos u omisiones; incluye 9 nuevas pruebas de recepcion mixta. Build frontend correcto (1534 modulos). `node --check` del webhook y `git diff --check` correctos. Revision de patrones de secretos sobre los cambios de codigo sin coincidencias de alta confianza; no constituye un escaneo exhaustivo.

Nuevas pruebas: `test/mixed-reception.test.js`.
Capturas: `output/qa/pending-ui-20260906/mixed-lot-1440.png` y `mixed-lot-390.png`.

## Publicacion pendiente y prueba real

No ejecutar confirmacion con la version remota actual: sigue activa la validacion antigua.

Orden de puesta en marcha:

1. Con autorizacion, inspeccionar y aplicar la migracion aditiva 31 ANTES del push. No borra ni modifica cantidades o filas historicas. MySQL DDL no se revierte con rollback.
2. Publicar solo los cambios revisados en main y verificar el despliegue.
3. Con autorizacion expresa para WhatsApp, renovar el resumen de OC6 y confirmar. No reutilizar a ciegas un borrador vencido o cuyo contexto haya cambiado.
4. Comparar stock y Kardex antes/despues: solo +3 disponibles; +1 cuarentena y +1 rechazado fisicos. Revisar el historico, trazabilidad por lote proveedor y por partida bloqueada; repetir la confirmacion para verificar idempotencia.

Comando de inspeccion (solo lectura):

```powershell
node scripts/apply-reception-supplier-lots-migration.js
```

Aplicacion, solo tras autorizacion:

```powershell
node scripts/apply-reception-supplier-lots-migration.js --apply --yes-i-understand-this-changes-the-qa-schema
```

Para revertir el codigo antes de nuevas recepciones basta mantener la columna adicional nullable. Despues de recibir partidas no se debe borrar su mapeo ni deshacer datos automaticamente.

## Limites y pendientes

- No se ejecutaron ALTER, confirmaciones reales, pruebas de concurrencia sobre MySQL ni mensajes WhatsApp en esta etapa. La doble transaccional no certifica aislamiento o sintaxis en el servidor real.
- La validacion definitiva relee el estado dentro de la transaccion; un cambio de estado, ubicacion o lote posterior al resumen aun puede impedir confirmar, como corresponde.
- Un lote historico globalmente bloqueado NO se libera automaticamente si se intenta recibir como disponible. Se mantiene el bloqueo y requiere evaluacion independiente.
- No se inventa un proceso nuevo para liberar cuarentena ni destruir rechazados.
- Por decision de Juan, consultar TODO el stock general por WhatsApp queda como pendiente de BAJA prioridad y no bloquea la bateria integral. Se priorizan SKU/alias, lote y excepciones.
