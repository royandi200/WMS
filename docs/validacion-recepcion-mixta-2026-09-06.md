# Recepcion mixta: mismo lote proveedor, distintas condiciones

## Resultado real por WhatsApp: 2026-09-06, 22:18-22:30 Bogota

**VALIDACION PARCIAL. Stock correcto; tres hallazgos abiertos.** Este corte sustituye
los estados de publicacion/validacion pendiente de las secciones locales inferiores.

- Publicado en main `1cd515646aaa2e56ec7c9eb67d83ab22567d6eac`; GitHub informo
  despliegue Vercel exitoso. Sin acceso directo a Vercel. Migracion31 aplicada
  previamente, aditiva y sin reescribir cantidades historicas.
- Perfil emisor: Juan admin. Datana recepcion_cierre y Jobana alistador sin cambios.
- OC6, recepcion61 `REC-OC-6-001`, SKU `00276-PTZNASHWA`, 5 und,
  lote fisico `QA-PREVIEW-20260906-IO`, vence 2027-11-30.
- No hubo carga/reenvio de PDF, cambios BBC, llamadas Siigo ni otra recepcion.

### Secuencia y evidencia

| Hora Bogota | Paso | Resultado observado |
| --- | --- | --- |
| 22:18 | Describir un producto, 5 und, distribucion 3/1/1 | Rechazado: producto repetido. Logs1746/1747: item_count2 para un solo SKU. Sin cambio de stock ni del resumen persistido anterior. |
| 22:21-22:22 | Aclarar que es un solo producto y repetir distribucion | Resumen correcto: 3 disponibles B13; 1 cuarentena y 1 rechazada CUAR-C-1-01, cada una con motivo. Lote/fecha correctos. Logs1748/1749 y nuevo resumen persistido con un item, tres distribuciones. |
| 22:22-22:23 | Confirmo la recepcion ID 6 | Confirmada 5/3/1/1. Logs1750/1751. Recepcion completada, OC RECIBIDA_PARCIAL con saldo2 por cantidades aceptadas. |
| 22:27 | Repetir Confirmo la recepcion ID 6 | Rechazo incorrecto de UX: Prepara primero la recepcion de la OC. Logs1752/1753. Cero nuevas escrituras de inventario. |
| 22:28 | Trazabilidad del lote proveedor | Relaciona las tres condiciones, cantidades recibidas, ubicaciones, motivos y partidas. Saldo seleccionado3. Mensaje expandido con Read more y leido completo. Logs1754/1755. |
| 22:29 | Trazabilidad de partida cuarentena | Relaciona lote proveedor y las otras partidas, saldo1 CUARENTENA. Read more expandido y texto completo leido. Historial muestra tipo de evento vacio. Logs1756/1757. |
| 22:28-22:30 | Dashboard Historico y Buscar Lote | Historico muestra las tres distribuciones y saldo OC2. Buscar Lote muestra recibido3/1/1, condicion, ubicacion, vencimiento y motivo; saldo de partida disponible3. |

Mensaje corto que SI permitio generar el resumen:

> Corrige el resumen de la recepcion ID 6. Es un solo producto: Zenova Ashwagandha.
> Llegaron 5 unidades del lote QA-PREVIEW-20260906-IO, vencimiento 30 de noviembre
> de 2027: 3 buenas en B13, 1 en cuarentena en CUAR-C-1-01 por revision de calidad
> y 1 rechazada en CUAR-C-1-01 por empaque roto. Solo muestrame el resumen,
> todavia no confirmes.

### Comprobacion SQL

| Medida | Antes | Despues de confirmar y repetir |
| --- | --- | --- |
| Stock SKU Zenova | 36.5 | 39.5 |
| Lots | 159 | 162 |
| Distribuciones recepcion | 42 | 45 |
| Kardex | 358 | 361 |
| Movimientos | 359 | 360 |

Disponible: lote `QA-PREVIEW-20260906-IO`, qty_current3, stock3.
Cuarentena: `RECBLK-3422e007c109a87963b8ffc42f983dc3`, qty_current1, stock0.
Rechazado: `RECBLK-acc1ed044af584c638f2d457382b8a64`, qty_current1, stock0.
Las tres distribuciones conservan el mismo lote_proveedor y vencimiento.
Rechazado no fue destruido. No se liberaron partidas bloqueadas.

### Hallazgos abiertos y siguiente arreglo acotado

1. **RM-01, auditoria, prioridad alta de correccion:** MySQL real define
   `kardex.action` como ENUM sin `INGRESO_RECEPCION_BLOQUEADO`; el codigo nuevo
   `api/v1/reception.js:335` usa ese valor. Las dos entradas bloqueadas persistieron
   con action vacio, aunque cantidades, lotes, saldo y notas son correctos.
   Se verifico COLUMN_TYPE y las filas; no se certifica el sql_mode de aquella conexion.
   Filas afectadas: `cb511164-71eb-4e5d-8337-b972cbcf71b0` y
   `94015922-3711-4483-a66a-bf054de551f7`. La trazabilidad WhatsApp expone `| : +1.000`.
   Requiere compatibilizar el evento con el esquema real y probar persistencia real
   del tipo, no solo mocks. Cualquier reparacion debe limitarse a estas filas
   verificadas, sin modificar cantidades y con registro de correccion.
2. **RM-02, idempotencia conversacional:** repetir con ID6 no duplica pero pide
   preparar de nuevo. `builderbot-reception.js:640` solo permite buscar completadas
   si la OC esta CERRADA; aqui quedo RECIBIDA_PARCIAL. Resolver la ultima confirmacion
   del usuario sin confundirla con una nueva recepcion parcial; no preparar ni confirmar
   una nueva recepcion como forma de aprobar esta prueba.
3. **RM-03, interpretacion:** el primer mensaje produjo dos items para un SKU y el
   guard de `builderbot-reception.js:438` rechazo correctamente. La reformulacion
   funciono, no es una correccion del problema original. BBC read_logs no entrego
   JSON completo de ese intervalo: no atribuir a MCP, nombre PDF ni causa de prompt
   especifica. Conservar el control de duplicados; agregar regresion de agrupacion
   sin sumar inadvertidamente cantidades duplicadas.

No se corrigieron estos tres hallazgos ni se reescribieron las dos filas de auditoria
durante esta validacion. No ejecutar otra bateria completa para resolverlos: primero
correccion acotada y revalidacion dirigida. Las 323 pruebas locales y el build pasaron,
pero sus dobles SQL no detectaron la diferencia ENUM real ni certifican el E2E.

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
