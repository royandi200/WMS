# Validacion dirigida posterior a arreglos

Fecha: 2026-09-06. Horas en America/Bogota.
Aplicacion: main, implementacion 9bbd5ac, documentacion b511e43.
Objetivo: comprobar los arreglos recientes antes del ensayo integral con cliente.

## Configuracion comprobada

- Juan: admin; Datana: recepcion_cierre; Jobana: alistador.
- Tres sesiones WhatsApp y dashboard disponibles.
- Consulta SQL inicial interrumpida por ECONNRESET; conexion recuperada antes de pruebas operativas.
- Las cargas manuales de PDF quedan al final, con aviso previo al usuario.
- Leer cada respuesta completa y desplegar Read more/Leer mas cuando aparezca.

## Resultados

### D01 - Alias exacto, ambiguedad y lotes agotados

- Hora: 12:23-12:24.
- Canal: WhatsApp Juan/admin.
- Entrada: `Cuanto stock hay de tapas blancas 60?`.
- Resultado: 00001-TPBI, disponible 6 und, lote QA-RX-0905-TPBI, ubicacion A8, vence 2027-12-31; encabezado FEFO.
- SQL: un lote con 6 und y reserva 0; dos lotes con saldo 0 excluidos de la respuesta.
- Entrada ambigua: `Cuanto stock hay de tapas?`.
- Resultado: pide escoger entre cinco presentaciones; no selecciona arbitrariamente.
- Estado: APROBADA. Pendiente de UX menor: candidatos redactados en un parrafo; lista vertical seria mas legible.

### D02 - Trazabilidad y Kardex

- Hora: 12:25. WhatsApp admin, lote TEST_AGENT-MPASH-FIFO-NEW; respuesta desplegada completa con Read more. Los 18 movimientos reconstruyen el saldo hasta 0.
- La paginacion conversacional sigue pendiente: este caso no genero varias paginas.
- Hallazgo: Kardex convertia UUID de lote a Number, por lo que no recalculaba saldos historicos por lote. Ejemplo SQL: merma QA-RX-0905-MPASH, saldo legacy 8540.1 frente a saldo de lote 1995.
- Correccion local: conservar UUID como cadena. Prueba del endpoint con dos lotes independientes verifica saldo 1995 y 7, sin mezclar producto.
- Repeticion dashboard 12:38-12:39: Kardex muestra merma de 5 g con saldo 1995 y saldos separados correctos para DEMO-GOMAS-001. APROBADA correccion de UUID; paginacion sigue pendiente.

### D03 - Trazabilidad inversa 3Q

- Hora: 12:26-12:28. WhatsApp admin, lote RECINT-64-90-01, respuesta completa desplegada.
- FALLO: mostraba envio a orden 5, pero omitia dos recepciones de PT existentes. Ademas incluia una orden cancelada sin envio confirmado.
- Causa comprobada: consulta utilizaba recepcion_distribuciones.producto_id, columna inexistente; catch ocultaba el error como ausencia de recepciones.
- Correccion local: unir recepcion_items con distribuciones por recepcion_item_id, filtrar recepciones completadas y envios confirmados del mismo producto. No silenciar fallos SQL.
- SQL corregido comprobado en lectura: REC-3Q-5-001 y REC-3Q-5-002, 2 und cada una, lotes MAN-034-3Q-BOS60-001 y MAN-035-3Q-BOS60-002.
- Repeticion WhatsApp 12:39: APROBADA; aparecen ambas recepciones y despacho FV-DEMO-MAN038-3Q-001 de 2 und al cliente QA. Ya no aparece la orden cancelada sin envio. Mensaje completo expandido.

### D04 - Corregir y descartar borrador 3Q

- Hora: 12:25-12:29. Dashboard Admin WMS.
- Documento ID 12 R04: restaurada fila 00026-ETRES120 por 29 und contrastada con PDF original. Paso de 8 filas/192 und a 9 filas/221 und; PENDIENTE_REVISION.
- Auditoria conserva antes/despues, motivo, actor y fecha. PDF original conservado sin cambios (3723 bytes y mismo SHA256).
- Documento QA anterior ID 9 R02 descartado con motivo y confirmacion. SQL: DESCARTADO, PDF retenido.
- Antes/despues: kardex 298, movimientos 307, ordenes maquila 4; checksum numerico de stock 21446.4850 y reservas 1072.8000 sin cambios. Checksums no son totales operativos porque mezclan unidades.
- Estado: APROBADA para correccion, descarte logico y ausencia de movimiento de inventario.

### Regresion automatizada tras hallazgos

- Suite local: 232 pruebas aprobadas, 0 fallidas. Incluye nueva prueba de endpoint con UUID.
- Esto no sustituye la repeticion en WhatsApp/dashboard ni acredita los casos aun pendientes.
- Publicado en main: 4213454. Verificacion funcional posterior confirma las dos correcciones en servicio.

### D05 - Produccion adicional y reintento

- Hora: 12:35-12:38. WhatsApp Juan/admin.
- Peticion de producir 1 tarro ashwagandha 60 para stock de seguridad: detecta OP 72 identica reciente y pide confirmar una adicional. No crea nada en esta primera peticion.
- Primera confirmacion `Confirma una nueva produccion adicional para la orden ID 72.` crea OP 75, 1 und, APROBADA, reserva BOM.
- Repeticion literal crea OP 76, 1 und, APROBADA, vuelve a reservar BOM: FALLO de idempotencia de confirmacion adicional.
- Ambas permanecen APROBADA; no se confirmaron materiales ni se consumio stock fisico. Reservas generadas por las dos ordenes: 360 g de gomas y 2 und de cada uno de los otros cuatro componentes.
- Causa: confirmar_nueva_orden evita la deteccion semantica sin una confirmacion consumible vinculada a la orden base. Bloquea acreditar reintentos seguros; revisar patron equivalente en merma/devolucion.
- Texto de siguiente paso correcto para admin: alistador notificado, no pide al admin confirmar materiales.

### D08 - Conteo de recepciones fisicas

- Hora: 12:39-12:41. Dashboard periodo 7 dias: 12 recepciones.
- SQL: 12 recepciones completadas distintas y 26 filas de items. APROBADO el conteo unico.
- Pendientes de presentacion/escala: tarjeta suma gramos y unidades bajo etiqueta unica de unidades recibidas; Entradas muestra 0 mientras recepciones muestra 6181. El dashboard consulta un limite de filas y agrega en frontend, por lo que validar volumen >100 antes de afirmar KPI completo.

## Pendientes de esta corrida

- D02: falta caso que realmente exceda una pagina conversacional. Los tres lotes consultados se leyeron completos con Read more, pero no excedieron el umbral.
- D05: corregir confirmacion adicional reutilizable; OP 75/76 quedan reservadas como evidencia QA, no iniciarlas.
- D06/D07: corregir reconocimiento conversacional y luego probar idempotencia; no se acredita porque no llegaron a ejecutar la accion.
- D09: carga manual WhatsApp de los dos PDF R09 y cotejo SQL/dashboard pendiente.

### D06 - Merma adicional desde registro previo

- Hora: 12:42. WhatsApp Juan/admin.
- Entrada: `Confirma una nueva merma adicional como MER-4ABBD46A.`
- Resultado: pregunta cantidad, producto/lote y orden/ubicacion en vez de recuperar la merma existente. FALLO conversacional; no se ejecuto registro adicional.
- Registro base: 5 g, 00051-MPASH, QA-RX-0905-MPASH, B16. Saldo sigue 1995 g.

### D07 - Devolucion adicional desde registro previo

- Hora: 12:43-12:44. WhatsApp Juan/admin.
- Entrada: `Confirma una nueva devolucion adicional como DEV-D42BAF7B.`
- SQL previo: despacho 49 entrego 2 und; 1 devuelta, 1 aun retornable.
- Resultado: vuelve a pedir datos y expone nombres tecnicos id_item/lote_origen. FALLO conversacional; no crea devolucion adicional.
- A las 12:51 SQL mantiene kardex 298, movimientos 307, mermas 25 y devoluciones 25. No hubo movimiento fisico en D05-D07; D05 si creo reservas.

### D02 - Observaciones adicionales de trazabilidad

- Hora: 12:44-12:45. DEMO-GOMAS-001 muestra saldo fisico 319.25 g y todos los movimientos al desplegar Read more.
- Pendiente: aparecen bajo "Ordenes que consumieron" ordenes con neto 0 (reservadas/no iniciadas). Separar consumo real de reserva prevista para no sugerir consumo inexistente.
- Pendiente: para OP 74, Kardex muestra entrega adicional a las 14:45 y trazabilidad WhatsApp 09:45 del mismo dia. Cotejar origen UTC y normalizacion; no acreditar consistencia horaria entre canales hasta resolver.

### D09 - Preparacion documental interna

- Hora: 12:46-12:51. Generados dos PDF R09 de dos paginas cada uno, sin conteos ni totales impresos; manifiesto esperado separado.
- OC: 11 SKU, 376 und y 8750 g; todos con lote propio y vencimiento 2028-12-31. Proveedor QA MULTISKU, fecha 2026-09-06.
- Salida 3Q: 9 SKU, 221 und; no declara lote ni vencimiento. Estos datos se asignan en el paso operativo, nunca inventados desde el documento.
- Hallazgo previo a WhatsApp: extractor nativo confundia fecha del encabezado de pagina 2 con vencimiento del ultimo item de pagina 1. Corregido conservando limites de pagina en tokens.
- Verificacion: las cuatro paginas renderizadas inspeccionadas sin recortes. Pruebas nuevas comparan todos los SKU, cantidades, unidades, lotes y vencimientos: 11/11 y 9/9 exactos.
- Suite completa posterior: 234 aprobadas, 0 fallidas. Esto acredita extraccion nativa local, no aun el flujo completo BBC/WhatsApp.
- Build frontend: aprobado a las 12:52; diff --check sin errores.
- Archivos: `output/pdf/regresion-documental/20260906-r09/QA-DOC-20260906-R09-OC-001.pdf` y `QA-DOC-20260906-R09-SALIDA-3Q-001.pdf`.
- Siguiente accion manual: Juan/admin envia primero la OC como documento PDF sin texto adjunto; se valida clasificacion por encabezado, conservacion del original y borrador sin inventario. Despues, remision 3Q del mismo paquete.
