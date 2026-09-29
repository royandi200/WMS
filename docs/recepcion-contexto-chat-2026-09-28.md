# Contexto de recepción por conversación

## Problema y alcance

Un «sí» a la revisión de un SKU fallaba con HTTP 409 si el mismo operario tenía
dos borradores abiertos. No eran dos aprobaciones: había una entrada y su
registro de rechazo. El webhook descartaba el contexto del último mensaje
del WMS y exigía que solo existiera un borrador.

La corrección corresponde al WMS, no requiere cambiar el prompt de BuilderBot.
Aplica a la recepción guiada directa de OC/IO; no cambia el flujo de MQ,
la aprobación administrativa ni la confirmación final de inventario.

## Resolución

- Cada respuesta guiada conserva IDs de recepción y orden, número de recepción,
  SKU seleccionado y SKU en revisión en `context.reception`.
- Con varios borradores, se usa la última respuesta procesada del WMS al mismo
  teléfono, dentro de la ventana existente de 30 minutos. Los marcadores de
  transporte duplicado se omiten; una acción posterior ajena a recepción
  impide recuperar una selección antigua.
- La selección debe corresponder a un borrador activo, no vencido y del mismo
  usuario. No se decide por fecha de actualización ni por IDs suministrados
  exclusivamente por la IA.
- El SKU revisado debe coincidir con el estado almacenado. Un «sí» valida ese
  SKU, nunca una recepción completa. Un resumen final no debe redirigir el
  «sí» al SKU pendiente de otra recepción.
- Compatibilidad con revisiones ya enviadas: se reconoce el encabezado exacto
  del mensaje del WMS y se cotejan orden, número de recepción y SKU contra el
  borrador. No se interpreta texto del usuario para este respaldo.
- Un ID explícito en el mensaje actual prevalece. Cuando falta evidencia
  inequívoca, se mantiene la solicitud de OC ID N / IO ID N.

No se migran ni eliminan borradores, ni se realizan movimientos de inventario.

## Verificación

Pruebas de regresión: dos borradores del mismo operario; «sí»; corrección de
ubicación; compatibilidad con revisión antigua; aislamiento de usuario;
contexto ausente, ajeno, vencido, completado o con SKU distinto; duplicados
de transporte; corrección desde resumen final; prevalencia del ID explícito.
El webhook conserva los identificadores en la respuesta enviada a BuilderBot.

La comprobación integral por WhatsApp requiere que el operario responda a una
revisión vigente. Las pruebas automatizadas no envían mensajes ni confirman
recepciones reales.
