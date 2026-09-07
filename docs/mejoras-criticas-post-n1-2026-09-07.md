# Mejoras indispensables posteriores a N1

Fecha: 2026-09-07. Estado: implementacion y regresion locales aprobadas; sin push ni despliegue en esta intervencion. Validacion WhatsApp pendiente.

## Alcance

Solo N1-05, N1-09 y N1-04 de `bateria-integral-20260906-noche.md`. No cambiar las reglas comerciales ni abrir nuevos flujos. Los resultados originales de la bateria se conservan: esta correccion no convierte retrospectivamente una prueba fallida en aprobada.

| Hallazgo | Cambio | Proteccion conservada |
| --- | --- | --- |
| N1-05: solicitud parcial ejecutaba el despacho completo | Leer restricciones del texto, aunque el modelo omita los campos de parcialidad. Si hay cantidad explicita, comprobarla contra las reservas dentro de la transaccion, antes de escribir. | Parciales desactivados; discrepancias bloqueadas; reintento de despacho terminado sin nueva salida. |
| N1-09: JSON de recepcion mixta con cierre estructural incorrecto | Recuperar exclusivamente los dos cierres malformados observados, con una linea y distribuciones completas que sumen el total. Exigir coincidencia del texto independiente y la OC. | Solo resumen: confirmacion_final debe ser false. Nunca recuperar una confirmacion final, contenido truncado ni datos ausentes. Autorizacion y validaciones operativas siguen en el flujo existente. |
| N1-04: confirmacion adicional tras PDF ignorada por fecha BBC | Retirar solo el prefijo de fecha en ingles del transporte legado; ignorar el marcador documental exacto segun la regla existente. | Texto independiente tiene prioridad, incluso vacio o negativo. Se mantienen consentimiento explicito, ID base y control de duplicados. |

## Archivos

- `api/_lib/dispatch-confirmation-input.js`: interpretacion conservadora de confirmacion y cotejo de cantidad.
- `api/_lib/dispatch-workflow.js`: cotejo dentro de la transaccion.
- `api/_lib/reception-json-envelope.js`: recuperacion estructural limitada a previsualizacion.
- `api/_lib/additional-operation-input.js`: normalizacion del prefijo legado.
- `api/v1/webhook/builderbot.js`: integracion con los handlers existentes.
- `test/critical-agent-input.test.js`, `test/builderbot-additional-consent.test.js`, `test/dispatch-workflow.test.js`: regresiones unitarias, webhook real con dependencias simuladas y transacciones simuladas.

## Verificacion local

- `npm.cmd test`: 344/344 aprobadas, sin omitidas. Incluye las nuevas regresiones y la suite existente de recepciones, documentos, produccion, movimientos adicionales, devoluciones, mermas, idempotencia y permisos.
- Desde `frontend`, `npm.cmd run build`: aprobado, Vite 5.4.21. No se instalaron dependencias.
- Las pruebas nuevas no llaman a servicios externos ni modifican inventario real. Las lecturas diagnosticas previas de logs SQL no son pruebas E2E del codigo nuevo.
- Durante la implementacion, la prueba del webhook detecto un enlace incorrecto del parametro de cantidad. Se corrigio antes del resultado final; la suite completa se repitio despues.
- No se modifico el prompt de BBC, configuracion, roles, esquema SQL ni datos de negocio en esta intervencion.

## Limites y riesgo residual

- No se garantiza interpretar cualquier frase de despacho. Cantidades ambiguas, unidades de embalaje sin conversion y restricciones parciales se bloquean; nunca se convierten en autorizacion de salida completa.
- La recuperacion JSON no es un reparador general: otro error estructural, varias lineas malformadas o truncamiento siguen rechazados. Un JSON valido sigue su ruta original.
- La compatibilidad con texto legado dentro de `info` no aporta autenticacion independiente de la transcripcion. Se conserva por compatibilidad con el transporte actual y no reemplaza el secreto del webhook.
- Pasar pruebas locales no demuestra entrega de mensajes, latencia BBC ni registro en la base conectada. No marcar estos tres hallazgos cerrados hasta la verificacion dirigida.

## Siguiente validacion dirigida, tras publicar

1. Despacho reservado por dos unidades: pedir una salida parcial de una; comprobar respuesta de bloqueo y cero cambios SQL. Confirmar luego el total y repetir: una sola salida.
2. Recepcion mixta de cinco unidades: tres disponibles, una en cuarentena y una rechazada, con lote, vencimiento, ubicacion y motivos. Ver resumen sin ingreso; confirmar una vez; cotejar dashboard y SQL. Solo tres deben ser disponibles. Repetir sin duplicacion.
3. Tras un PDF, confirmar una operacion adicional sobre una base conocida: debe reconocer el consentimiento y ejecutarla una vez. Repetir para comprobar idempotencia y probar una negacion sin efecto.

Anotar hora de cada mensaje, actor/rol, respuesta completa, evidencia del dashboard y diferencias SQL antes/despues. No reenviar operaciones automaticamente ante silencio. No requiere repetir ahora toda la bateria ni pedir nuevos PDFs para cubrir el despacho y la recepcion mixta.
