# Correccion dirigida RM-01, RM-02 y RM-03

Base: 1cd5156. Alcance: preparar la siguiente bateria, sin cambiar flujos ajenos.

## Cambios

- RM-01: el ingreso fisico bloqueado usa INGRESO_RECEPCION, admitido por el ENUM
  de la migracion28 y por MySQL real. Notas indican condicion y disponible +0.
  Ningun bloqueado escribe stock disponible ni movimiento de entrada disponible.
- RM-02: confirmacion explicita por ID de OC sin recepcion activa puede reconocer
  una recepcion completada aunque la OC siga RECIBIDA_PARCIAL. Si existe otra
  recepcion activa, se mantiene su validacion y requiere su propio resumen vigente.
  Un reporte fisico ordinario no se interpreta como repeticion de una confirmacion.
- RM-03: fragmentos de un SKU se agrupan solo si sus distribuciones son disjuntas
  por lote/condicion/ubicacion. Cada subtotal declarado debe cuadrar primero.
  Solapamientos, vencimientos incompatibles, motivos contradictorios y mas de20
  distribuciones fallan cerrados. Se valida el total agrupado contra el saldo OC.
  No se eliminan duplicados a ciegas, ni se relajan lote/fecha/ubicacion/motivo,
  resumen persistido por usuario o confirmacion explicita.
- Sin cambios de prompt, modelos BBC, PDF, roles, Siigo ni dependencias.

## Reparacion auditada de QA61

`scripts/qa/repair-mixed-reception-audit.js` por defecto solo inspecciona.
Aplicacion explicita con `--apply --confirm-qa-reception-61` realizada: corrige
unicamente action y anota la correccion en notes para las dos filas identificadas
en [validacion previa](validacion-recepcion-mixta-2026-09-06.md).
Usa transaccion, bloqueo, huella de recepcion/producto/lote/condicion/cantidad y
comparacion de TODOS los campos despues del UPDATE. Reintento no cambia filas.
No modifica cantidades, saldos, tx_id, autores, fechas ni agrega ingresos.

Conteos SQL despues: kardex361, movimientos360, lots162, distribuciones45,
stock Zenova39.5; identicos al cierre de la validacion anterior.

## Pruebas locales

- 334/334 pruebas, sin fallos ni omisiones. Build frontend correcto:1534 modulos.
- Once pruebas nuevas: agrupacion disjunta y sus limites, alias, duplicado con otra
  cantidad, subtotal ambiguo, vencimientos, repeticion de OC parcial, seleccion de
  recepcion activa, reparacion dry-run/idempotente/rollback.
- El doble del handler real de recepcion ahora rechaza eventos ajenos al ENUM de
  migracion28, que coincide con el tipo observado en MySQL. Se mantiene prueba
  de solo3 disponibles, bloqueados separados y rollback ante fallo.
- Las pruebas automatizadas usan dobles, no equivalen a una bateria completa real.

## Despliegue y revalidacion

Pendientes en este corte: publicar solo el paquete acotado en main, comprobar
despliegue por GitHub, repetir confirmacion por WhatsApp, consultar la partida
cuarentena reparada y probar un resumen mixto sin confirmar otro ingreso.
Se agregaran abajo las horas y resultados efectivos. No reenviar documentos.
