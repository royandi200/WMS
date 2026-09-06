# Confirmaciones adicionales de un solo uso

## Alcance

Produccion, merma, devolucion de cliente y ajuste de materiales de una OP.
Las referencias nuevas de merma/devolucion ya eran opcionales en WhatsApp y
dashboard: WMS genera AUTO-MER/AUTO-DEV y MER/DEV. No confundirlas con el lote
fisico del proveedor ni el despacho origen, que siguen siendo datos necesarios.

## Contrato

Una solicitud normal repetida conserva la deteccion semantica de las ultimas
24 horas. No modifica stock; muestra el registro existente y permite confirmar
una operacion adicional real.

La confirmacion adicional identifica una base existente devuelta por WMS:

| Operacion | Indicador explicito | Base existente |
| --- | --- | --- |
| Produccion | confirmar_nueva_orden | id_orden_existente |
| Merma | confirmar_nueva_merma | id_merma_existente |
| Devolucion | confirmar_nueva_devolucion | id_devolucion_existente |
| Material de OP | confirmar_nuevo_ajuste | id_ajuste_existente |

El dashboard conserva esa base automaticamente. El clasificador la recupera
del historial o de la referencia que el usuario seleccione; nunca debe inventar
un codigo. La misma confirmacion debe conservar la base ORIGINAL, no sustituirla
por el nuevo registro creado al confirmar. Si hay ambiguedad, se pide seleccionar
un registro existente. No se interpreta un timeout como una nueva operacion.

La clave durable es tipo + usuario autenticado + ID numerico de la base.
confirmaciones_adicionales guarda un hash del payload normalizado y el resultado.
El indice unico serializa solicitudes concurrentes. La reserva de la clave,
los movimientos y el resultado se confirman en la MISMA transaccion InnoDB.
Un rollback deja la confirmacion disponible. Un reintento recupera el resultado
antes de validar el estado mutable del stock/OP o el saldo retornable y no
repite movimientos ni notificaciones de liberacion de produccion.

Un payload diferente con la misma clave produce conflicto, no una nueva
operacion. La confirmacion no caduca. Para otra operacion genuinamente nueva,
el usuario inicia una nueva solicitud; el detector devuelve el registro mas
reciente, que sera una nueva base. Otra persona tiene su propia confirmacion:
esto no sustituye la coordinacion operativa entre usuarios distintos.

## Instalacion y verificacion

Aplicar la migracion ANTES del despliegue. No modifica historicos ni inventario:

```powershell
node --use-system-ca scripts/apply-additional-confirmations-migration.js
node --use-system-ca scripts/apply-additional-confirmations-migration.js --apply --yes-i-understand-this-changes-the-qa-schema
node --test test/additional-confirmation.test.js
node --use-system-ca scripts/qa/check-additional-confirmations-isolated.js
npm.cmd test
npm.cmd --prefix frontend run build
```

La comprobacion SQL usa tablas temporales de sesion; verifica commit, rollback,
reintento por ID/codigo y conflicto sin escribir tablas operativas. Las pruebas
unitarias ejecutan los cuatro workflows con un doble transaccional y cubren
concurrencia simulada. Eso NO sustituye un ensayo concurrente entre dos
conexiones MySQL ni la validacion de interpretacion real de voz/WhatsApp.

Si falta la tabla, la confirmacion falla cerrada: no hay bypass por booleano.
No se retroasignan claves a operaciones anteriores al despliegue: los duplicados
historicos OP 75/76 y MER-84D14B9F/MER-A6C5FC05 se preservan como evidencia.
No repetir esas confirmaciones antiguas para verificar el arreglo; usar bases
nuevas con stock controlado. No se infieren relaciones historicas no registradas.

## Regresion dirigida

Para cada flujo, crear una base nueva, solicitar otra operacion identica,
confirmarla y reenviar literalmente la confirmacion. Debe haber un solo nuevo
registro y un solo efecto sobre inventario/reservas. Verificar tambien despues
de cerrar la OP o agotar el saldo retornable. Conservar hora Bogota, actor,
base, resultado, mensajes completos y diferencias de SQL/dashboard en
validacion-dirigida-2026-09-06.md.

## Guardado conversacional de materiales

Desde el ajuste del 6 de septiembre, "entrega adicional" solo indica tipo de
movimiento: no autoriza omitir deteccion de duplicados. El backend exige texto
explicito para confirmar otro ajuste y valida que el ID numerico corresponda a
un movimiento del propio usuario. Recupera orden, SKU, cantidad, lote y ubicacion
de SQL; no usa un codigo inventado por la IA. Datos contradictorios y negaciones
se rechazan sin inventario. El mensaje incluye el ID real para seleccionarlo.
Ensayo real: base 395 -> resultado 396; reintentos antes/despues del cierre de
OP 77 recuperan 396. Consultar bitacora para horarios y saldos.
