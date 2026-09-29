# Recepción guiada: varios SKU en un mensaje

Se conserva la acción `AVANZAR_RECEPCION_GUIADA_OC` para OC directa e In & Out.
Un producto usa `params.avance`; varios usan `params.avances`, una lista de
1 a 100 objetos con referencia de producto y únicamente los datos actuales.
Los dos contratos son excluyentes. Cada SKU aparece una vez, con sus partidas
si llegó repartido entre estados, ubicaciones o lotes.

La captura completa se guarda en una transacción, sin inventario ni kardex.
Los SKU se resuelven solo dentro de la recepción del usuario. Una referencia
ambigua, ajena o duplicada rechaza el mensaje sin guardar un batch parcial.
Un SKU incompleto se conserva, sin inventar campos ni descartar los siguientes.
Los datos completos se validan mediante las mismas reglas de recepción.

## Ejercicio de la OC 41

Tras revisar los tarros, el operario dicta tapas (30, disponibles, A8),
etiquetas (30, disponibles, A11), liners (20 disponibles en B10 y 10 en
cuarentena) y gomas (5400 gramos, disponibles, A10).

Se conservan los cuatro SKU y los tarros revisados. Para los liners quedan
pendientes la ubicación de la partida 2 y la causa concreta de la cuarentena;
«mal estado» no basta como causa. No se copia B10 ni A10 a esa partida.
El operario completa «partida 2, ubicación [código real], motivo [causa]».
Después se revisan los SKU capturados y sus lotes/vencimientos físicos.
Un «sí» revisa únicamente el SKU mostrado, nunca confirma la recepción.
Solo la confirmación final explícita puede afectar inventario.

Una corrección conjunta desde el resumen final usa `correccion: true` y
`avances` con la referencia de cada producto y sus campos corregidos.
Se conservan los campos no corregidos y los otros productos; lo modificado
requiere revisión de nuevo.

## Publicación y resguardo

Publicar el backend antes de sincronizar el prompt. El script
`scripts/qa/apply-batch-reception-builderbot.mjs --baseline=b539678` verifica
el bloque de recepción guiada contra el commit anterior y modifica solo
ese bloque en Entrada y Voz del bot migrado
`7fdf8f81-e227-4a04-8943-5402d3be4b15`. El bot original de soporte no se toca.
El modo por defecto es lectura; `--apply --reboot` aplica y reinicia.
La copia previa de los dos prompts se conserva en el directorio de trabajo
`.tmp/builderbot-pre-batch-reception-20260928.json`; no contiene credenciales.
El script compara la configuración y relee las instrucciones para comprobar
que no cambió el resto de los flujos ni sus reglas.

Las pruebas cubren la transcripción, cantidades por estado, datos faltantes,
persistencia de los otros SKU, revisión secuencial, correcciones del resumen,
límites, rechazo atómico, aislamiento por usuario y permisos del webhook.
No prueban por sí solas la salida de un modelo en una conversación real.
