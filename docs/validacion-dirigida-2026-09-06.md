# Validacion dirigida posterior a arreglos

Fecha: 2026-09-06. Horas en America/Bogota.
Linea base al iniciar: main, implementacion 9bbd5ac, documentacion b511e43. Los despliegues y resultados posteriores se detallan cronologicamente; la consolidacion vigente esta al final.
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

## Pendientes de esta corrida al primer corte (historico)

- D02: falta caso que realmente exceda una pagina conversacional. Los tres lotes consultados se leyeron completos con Read more, pero no excedieron el umbral.
- D05: corregir confirmacion adicional reutilizable; OP 75/76 quedan reservadas como evidencia QA, no iniciarlas.
- D06/D07: corregir reconocimiento conversacional y luego probar idempotencia; no se acredita porque no llegaron a ejecutar la accion.
- D09: OC R09 validada como borrador con observaciones de presentacion; remision 3Q R09 probada y RECHAZADA. Corregir y repetir antes de acreditar flujo documental completo.

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

### D09-A - OC R09 recibida por WhatsApp sin texto adjunto

- Fecha/hora: 2026-09-06, envio y respuesta 12:57; persistencia SQL 12:57:38 Bogota; cotejo final 13:01.
- Actor: Juan/admin. Documento de 2 paginas enviado sin leyenda adjunta, segun mensaje visible de WhatsApp.
- Resultado: clasificado ORDEN_COMPRA, un borrador ID 17, QA-DOC-20260906-R09-OC-001, PENDIENTE_REVISION. Respuesta completa legible, sin JSON.
- Comparacion programatica SQL contra expected.json: 11/11 SKU, cantidad, unidad, lote y vencimiento exactos; los 11 enlazados al catalogo. Totales separados: 376 und y 8750 g.
- Dashboard: Recepciones > Ordenes de compra muestra tarjeta y formulario Revisar con 11 renglones, sus lotes y vencimientos; fecha 2026-09-06 y proveedor PROVEEDOR QA MULTISKU SAS. No se eligio otro proveedor ni se confirmo/creo OC operativa.
- PDF conservado: 4461 bytes, SHA256 647556b6ca092eacef2ed456289e281814117dc361210c167ef2b95ed45cb771. Coinciden archivo local, hash almacenado y hash calculado sobre contenido SQL.
- Integridad: kardex 298 y movimientos 307, iguales al control previo. Checksum stock 21446.4850 y reserva 1440.8000; las reservas incluyen las dos OP de D05, no provienen de este PDF.
- Advertencia esperada: proveedor ficticio no encontrado inequivocamente entre proveedores sincronizados. No corresponde a omision de SKU ni obliga a cambiar el proveedor automaticamente.
- Observaciones pendientes: WhatsApp dice Total: 376 y omite los 8750 g, mientras dashboard si desglosa ambos; corregir resumen por unidad. NIT y moneda permanecen null (fuera de criterio bloqueante por decision previa del usuario). La descripcion extraida de 00001-TPBI omite '(60 UNID)', pero SKU, catalogo y campos operativos coinciden.
- Estado: APROBADA carga y fidelidad de campos operativos del borrador; presentacion de totales WhatsApp pendiente. La aprobacion no incluye recepcion fisica, conciliacion con proveedor real ni idempotencia de reenvio de este PDF.
- Siguiente prueba: cargar QA-DOC-20260906-R09-SALIDA-3Q-001.pdf desde Juan/admin sin texto adjunto. Esperados 9 SKU, 221 und, sin lotes ni vencimientos inventados y sin movimiento de inventario.

### D09-B - Remision R09 recibida por WhatsApp sin texto adjunto

- Fecha/hora: 2026-09-06, envio 13:03; respuesta 13:04. SQL webhook RECEIVED id 1462 a las 13:04:04 y REJECTED id 1463 a las 13:04:05 Bogota.
- Actor: Juan/admin. Mensaje visible contiene PDF de 2 paginas, sin leyenda adjunta.
- Respuesta completa: `El item 1 requiere SKU exacto en codigo de barras`. Estado: FALLIDA, no acreditar lectura documental 3Q punta a punta.
- API recibio action REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO, tipo SALIDA_BODEGA_3Q, referencia correcta, item_count 9 y pdf_reference_received true. La clasificacion si llego al handler correcto.
- SQL: no existe borrador para QA-DOC-20260906-R09-SALIDA-3Q-001. Dashboard Maquila 3Q > Documentos leidos tampoco lo muestra.
- Integridad: kardex 298, movimientos 307, checksum stock 21446.4850 y reserva 1440.8000, iguales al control anterior. No se creo remision ni se modifico stock.
- Catalogo SQL: los nueve SKU del PDF existen y tienen activo=1. No atribuir el error a SKU inexistente ni pedir cambiar el PDF sin diagnostico.
- Pruebas locales reejecutadas: `node --test test/pdf-multipage-r09.test.js`, 2/2 aprobadas, incluyendo nueve SKU/cantidades/unidades exactos sin inventar lote/vencimiento de la remision.
- Causa aun no confirmada: normalizeItem recibio el primer item sin sku/codigo_barras/barcode utilizable. Falta establecer por que nativePdfEvidence/preferNativeItems no restituyo los campos en esta llamada. El catch de extraccion nativa no deja diagnostico y los logs SQL documentales omiten el contenido por privacidad; no inferir que el OCR o el JSON fue la causa sin evidencia.
- Intento de lectura BBC por MCP: conexion disponible, pero el log recuperado ya no incluia la ventana del fallo (solo un evento posterior). No se recupero payload original ni PDF remoto de este intento.
- Siguiente paso tecnico: diagnostico saneado de disponibilidad/descarga/extraccion PDF, cantidad de filas nativas y esquema de campos del modelo, sin registrar PDF, URL temporal ni secretos; probar registerWarehouseDocumentDraft completo, no solo extractor aislado. Repetir la misma remision despues de corregir; no pedir reenvios a ciegas.
- En esta comprobacion no se modificaron codigo, prompts, roles ni datos operativos. Solo se actualizo la bitacora local.

### D09-B - Correccion del contrato compacto y registro completo

- Fecha/hora: 2026-09-06, diagnostico y regresion interna 13:11-13:23 Bogota. No se enviaron mensajes ni se escribio en bases vivas durante esta correccion.
- Causa reproducida: el prompt documental publicado en BBC exige filas posicionales `[sku, descripcion, cantidad, unidad, lote, vencimiento]`; el normalizador de OC las admitia, pero el de salida 3Q solo leia propiedades de objetos. Reproducido localmente el mismo error `El item 1 requiere SKU exacto en codigo de barras` con el contrato indicado por el prompt.
- Limite de la evidencia: el payload original de las 13:04 no se recupero. La incompatibilidad contractual esta comprobada, pero sigue sin conocerse por que la extraccion nativa no reemplazo esas filas en aquella llamada. No atribuir este fallo a una lectura incorrecta del PDF por el modelo.
- Hallazgo adicional reproducido en registro completo: despues del extractor nativo, enrichItemsFromLineEvidence volvia a colapsar el salto de pagina. Asignaba a 00003-TPGG la referencia del documento como lote y la fecha del encabezado de pagina 2 como vencimiento. El test aislado del extractor no cubria esta etapa.
- Correcciones: normalizar filas compactas 3Q antes de validarlas; conservar limites de pagina tanto en enriquecimiento por lineas como en texto aplanado. No se inventan lotes/vencimientos que el documento no contiene.
- Diagnostico agregado: estados fijos y conteos de filas compactas/nativas en contexto y logs del webhook 3Q, incluidos rechazos de normalizacion. No contiene texto del PDF, URL temporal, credenciales ni errores crudos del parser. Permite distinguir NO_PDF, NO_TEXT_LAYER, PDF_PARSE_FAILED, CATALOG_READ_FAILED, NATIVE_ROWS_FAILED, MODEL_FALLBACK y NATIVE_APPLIED.
- Regresion nueva: seis casos de contrato/registro 3Q, con descarga simulada del PDF R09 real, SQL en memoria limitado a tablas de borradores, reintento compacto/objeto, fallo de catalogo nativo simulado, conflicto por cantidad y rechazo de datos invalidos; otros dos casos verifican limites de pagina por lineas y texto aplanado.
- Resultado: 9/9 SKU, 221 und, lotes y vencimientos null, PDF original preservado y sin duplicacion. El registro completo pasa tanto con extraccion nativa como con fallback documental; el fallback se prueba con evidencia textual de la misma fuente, no con una respuesta capturada de BBC.
- Suite completa: 242 aprobadas, 0 fallidas; build frontend aprobado 13:22; diff --check sin errores. Revision con wms-security-audit standard acotada al contrato externo, privacidad, idempotencia y controles sin mutacion de inventario. Sin cambios de dependencias, roles ni prompt BBC.
- Estado: CORREGIDO Y VALIDADO LOCALMENTE. Sigue pendiente el reenvio real de QA-DOC-20260906-R09-SALIDA-3Q-001.pdf tras despliegue, cotejo de nueve filas en SQL/dashboard, respuesta WhatsApp y ausencia de movimientos. Los pendientes D02/D05/D06/D07/D08 no se dan por resueltos con esta correccion.
- Publicacion: commit b1441daa876d8176ea2aeaa3932962f766f060ec enviado directamente a main. GitHub reporta estado Vercel success a las 13:26:07 Bogota; no se accedio directamente a Vercel. Esto acredita despliegue, no aun funcionamiento punta a punta.
- Control SQL previo al reenvio: kardex 298, movimientos 307, checksum stock 21446.4850, reservas 1440.8000, borradores de la referencia R09-SALIDA-3Q: 0. Sin cambios respecto a las 13:04. Una lectura fallo transitoriamente por ECONNRESET; reintento exitoso.

### D09-B - Interrupcion de comunicacion durante el reenvio

- Fecha: 2026-09-06; horas Bogota. Usuario reporta primer envio sin respuesta y posterior borrado/reenvio. WhatsApp Juan/admin muestra mensaje eliminado a las 13:26 y PDF R09-SALIDA-3Q enviado a las 13:29, entregado sin respuesta.
- 13:30-13:33: no hay nuevas llamadas documentales al webhook ni borrador R09-SALIDA-3Q. La API si registra un MODO_CHARLA de otra linea a las 13:28:34, por lo que no se acredita una caida total del WMS. No atribuir el silencio al parser corregido: estos envios no llegaron al handler.
- BBC MCP indica ONLINE; diagnostico UI informa instancia activa pero bot desconectado, sin numeros bloqueados, token Meta valido y webhook Meta configurado. El diagnostico sugiere QR aunque el canal configurado es Meta, por lo que esa recomendacion no se toma como prueba concluyente de la causa.
- Consulta de control desde Juan/admin a las 13:33: `Cuanto stock hay de tapas blancas 60?`; entregada, sin respuesta ni registro en WMS.
- Recuperacion: solicitado un unico reinicio del contenedor BBC Bodega Inventarios aproximadamente 13:34, sin publicar cambios de flujo ni modificar prompts, permisos, claves o codigo WMS. Estado posterior ONLINE.
- Repeticion de la misma consulta a las 13:35: respuesta WhatsApp correcta, 00001-TPBI disponible 4 und, lote QA-RX-0905-TPBI en A8. Webhook 1466 RECEIVED 13:35:10 y 1467 PROCESSED 13:35:11. APROBADA recuperacion del canal de texto tras reinicio, no la lectura PDF.
- Limite de observabilidad: MCP builderbot_read_logs devuelve `NO logs registrados` incluso al consultar tras el mensaje exitoso. No se dispone de traza interna para demostrar si la causa raiz fue sesion, cola, entrega de Meta o analisis documental; no afirmar diagnostico mas especifico.
- Integridad posterior: borradores R09-SALIDA-3Q 0, kardex 298, movimientos 307, checksum stock 21446.4850 y reserva 1440.8000. No se ejecuto ninguna operacion de inventario ni se recupero automaticamente el PDF anterior.
- Pendiente operativo: reenviar una vez el mismo PDF desde Juan/admin, sin borrar el envio ni adjuntar texto; verificar recepcion BBC, diagnostico saneado del parser, nueve filas/221 und, evidencia original y respuesta final. Mantener abierta la validacion documental hasta ese cotejo.

### D09-B - Reenvio tras recuperacion: incompleto, NO APROBADO

- Fecha/hora: 2026-09-06, envio y respuesta WhatsApp 13:37; cotejo SQL y dashboard hasta 13:41 Bogota. Perfil Juan/admin. PDF sin texto adjunto.
- Comunicacion restablecida: webhook 1468 RECEIVED 13:37:52, 1469 PROCESSED 13:37:54. Respuesta legible sin JSON, borrador ID 18, pero informa 8 items/192 und en lugar de 9/221. La respuesta HTTP exitosa no acredita fidelidad documental.
- SQL y dashboard Maquila 3Q > Documentos leidos confirman ocho filas y ausencia de 00026-ETRES120, ETIQUETA RESVERATROL x 120, cantidad 29 und. Los SKU presentes y sus cantidades/unidades coinciden con las otras ocho filas del manifiesto R09.
- Error adicional: 00003-TPGG tiene lote QA-DOC-20260906-R09-SALIDA-3Q-001 y vencimiento 2026-09-06, que son la referencia/fecha del encabezado y NO datos de ese producto. El PDF no declara lotes ni vencimientos para ninguna de sus nueve filas.
- Diagnostico desplegado confirma PDF_PARSE_FAILED, model_rows 8, compact_rows 8 y native_rows 0. El contrato compacto ya se acepta; ahora se comprueba que la lectura nativa falla en servidor y se usa fallback. No se dispone aun de la excepcion interna concreta (modulo, worker o dependencia de runtime); no adjudicarla sin reproduccion.
- Evidencia original intacta: 4026 bytes, SHA256 017c709ee74c8b58a502a528e62e19640622827bc0ad26689ca71d4ff565729f. Coinciden PDF local, hash SQL y SHA2 del contenido almacenado. No es un archivo truncado durante transferencia.
- Estado incorrectamente poco informativo: PENDIENTE_REVISION sin advertencias pese al fallo nativo. La revision humana sigue siendo obligatoria, pero no se debe presentar como una lectura verificada. Revisar politica de fallo de extraccion para hacer visible/bloqueante la imposibilidad de comprobar integridad segun corresponda.
- Revision de codigo: el enriquecedor preserva limites de pagina cuando recibe form-feed del extractor nativo. Ese control no basta para evidencia de BBC que no conserva la misma estructura; tampoco sabemos si los valores errados ya venian del modelo o fueron enriquecidos, porque el payload completo no se almacena. No asumir corregido ese camino por las pruebas locales.
- Integridad a las 13:41: kardex 298, movimientos 307, checksum stock 21446.4850, reserva 1440.8000. Borrador ID 18 permanece sin vincular ni corregir para conservar evidencia. No se confirmo remision, no se modificaron roles ni inventario.
- Siguiente trabajo antes de otro reenvio: diagnosticar/reproducir carga de PDF.js y sus dependencias en el empaquetado servidor; verificar el registro completo contra el PDF almacenado; evitar enriquecimiento con encabezados y hacer visible la falta de verificacion nativa. No remediar omision aumentando totales impresos ni dando por buenas las ocho filas.
- En esta comprobacion no se modifico codigo ni se hizo push; solo se documento el resultado. La bateria documental sigue abierta y no se solicita un nuevo PDF todavia.

### D09 - Lector compartido y verificacion en servidor

- Correccion en curso autorizada por el usuario: carga explicita de canvas y worker PDF.js, inclusion de archivos auxiliares en funciones Vercel y liberacion del documento en finally. OC y 3Q usan document-pdf-evidence.js, sin catch silencioso duplicado.
- La documentacion oficial de Vercel describe includeFiles para archivos que el trazado no incorpora: https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions . PDF.js separa el worker del modulo principal: https://mozilla.github.io/pdf.js/getting_started/ . Se utiliza la dependencia existente, sin cambiar versiones ni lockfiles.
- Si falla tecnicamente la lectura/carga/catalogo, el handler rechaza antes de iniciar la transaccion; no guarda una extraccion parcial silenciosa. Si el PDF carece de texto nativo o no se pueden recuperar filas suficientes, el borrador requiere correccion, con advertencia explicita. No se afirma lectura perfecta de escaneos.
- Verificacion nueva de solo lectura: GET /api/v1/warehouse-documents?inspect_pdf=ID, restringido a admin/administrador antes de abrir la conexion. Verifica hash del original, ejecuta el mismo lector y devuelve campos extraidos/conteos sin texto crudo, URLs temporales ni excepciones internas. No modifica borradores ni inventario.
- El enriquecimiento no vuelve a rellenar valores opcionales cuando las filas ya proceden del lector nativo, evitando que una ausencia de lote/vencimiento sea sustituida por un encabezado.
- Regresion local: 247 pruebas aprobadas, build frontend aprobado. Casos nuevos cubren ambos PDF almacenados, recuperacion de ultima fila omitida por la IA, integridad, permisos y rechazo antes de escrituras si falla el lector. Registro 3Q conserva nueve filas/221 und y reintento idempotente.
- Comando reproducible de lectura remota: con E2E_DASHBOARD_EMAIL y E2E_DASHBOARD_PASSWORD en entorno, node --use-system-ca scripts/qa/inspect-stored-pdf.js 17 18. Contrasta los archivos realmente almacenados contra hashes y campos de los PDF R09 locales. No se declara verificacion remota hasta ejecutarlo despues del despliegue.

### D09 - Resultado desplegado y saneamiento del borrador R09

- Fecha: 2026-09-06, horas Bogota. Commit 64934aee07d0c3cecce57aab5bc649467600d3f7 enviado a main; GitHub confirma despliegue Vercel success. No se accedio directamente a Vercel.
- 13:58:48: ejecutado inspect-stored-pdf.js contra el servidor con los originales almacenados, no sustitutos locales. OC ID 17: dos paginas, 11/11 referencias; salida 3Q ID 18: dos paginas, 9/9 referencias. Ambos devuelven NATIVE_APPLIED. El script comprueba hashes y campos exactos SKU/cantidad/unidad/lote/vencimiento contra el manifiesto de las pruebas. Ninguna escritura de borrador ni inventario durante esta inspeccion.
- El resultado demuestra lectura nativa correcta en el runtime desplegado para ambos PDF. No permite atribuir a un modulo concreto la excepcion anterior, cuyo stack no se recupero; tampoco equivale a un nuevo recorrido completo BBC/WhatsApp.
- 14:02:49 y 14:04:08: correccion deliberada del borrador 3Q ID 18 mediante el formulario existente del dashboard, usuario Admin WMS (ID 1), auditada en system_logs 73 y 74. Se recupero 00026-ETRES120, 29 und, y se retiraron lote/vencimiento indebidamente tomados del encabezado de 00003-TPGG. Es saneamiento del borrador fallido, no una nueva extraccion automatica de WhatsApp.
- Novedad UI/automatizacion: vaciar el control de fecha parecio efectivo en snapshot, pero la primera escritura conservo el vencimiento. Se detecto por SQL antes de cerrar la prueba; se reconstruyo esa fila en el mismo formulario, preservando SKU y cantidad, y la segunda escritura lo elimino. Registrar para reproduccion posterior manual: distinguir comportamiento del control de fecha y eventos de automatizacion; causa no establecida.
- Resultado SQL final: 9 filas, 221 und, cero lotes y cero vencimientos declarados, coherente con el PDF de salida. El documento original permanece en 4026 bytes y SHA256 017c709ee74c8b58a502a528e62e19640622827bc0ad26689ca71d4ff565729f, coincidente con SHA2(contenido,256).
- Integridad final: kardex 298, movimientos 307, checksum stock 21446.4850 y checksum reservas 1440.8000, identicos al control previo. Estos sumatorios mixtos son controles de integridad, no indicadores operativos. No se creo/vinculo/confirmo remision, OC ni movimiento.
- Estado: lector desplegado APROBADO para los originales OC y 3Q; saneamiento auditado APROBADO. Pendiente repetir una vez el mismo PDF 3Q desde Juan/admin para verificar relectura por webhook con NATIVE_APPLIED y respuesta idempotente de documento ya registrado, sin duplicar ni modificar inventario. No se necesita un nuevo PDF. Los pendientes D02/D05/D06/D07/D08 siguen abiertos.

### D09-B - Reenvio real R09 aprobado tras correccion

- Fecha/hora Bogota: 2026-09-06, PDF enviado 14:06 desde Juan/admin sin texto adjunto; webhook 1470 RECEIVED 14:07:04 y 1471 PROCESSED 14:07:06. Respuesta WhatsApp completa y legible, sin JSON ni truncamiento: documento ya registrado, no duplicado, 9 items, 221 unidades, PENDIENTE_REVISION, sin modificacion de inventario.
- Diagnostico real del webhook: NATIVE_APPLIED, model_rows 8, compact_rows 8, native_rows 9. El modelo sigue omitiendo una fila, pero el lector nativo desplegado recupera las nueve desde el original antes de validar el reintento. No atribuir la recuperacion al prompt ni a la correccion manual del borrador previo.
- Cotejo SQL: existe un solo borrador para la referencia, ID 18, nueve filas/221 und, cero lotes y cero vencimientos, sin OC ni remision vinculadas. Kardex 298, movimientos 307, checksum stock 21446.4850 y reservas 1440.8000: sin cambios respecto al control anterior.
- Resultado: APROBADA lectura nativa por el recorrido real WhatsApp/BBC/webhook y APROBADA idempotencia del mismo PDF. Esta prueba utiliza un borrador previamente saneado; no constituye prueba de alta nueva en servidor tras este despliegue. El alta nueva completa cuenta con regresion local, y debe distinguirse de esta evidencia de reintento. No se probo un PDF escaneado ni se cierran los otros pendientes funcionales.

## Consolidacion vigente y siguiente prueba - 2026-09-06, 14:13 Bogota

Esta seccion actualiza los cortes historicos anteriores. Un resultado local o de un caso concreto no cierra automaticamente todo su paquete funcional.

### D10 - Alta nueva documental R10 (preparada, pendiente de envio)

- Archivo: `output/pdf/regresion-documental/20260906-r10/QA-DOC-20260906-R10-SALIDA-3Q-001.pdf`. Referencia nueva, dos paginas, nueve SKU activos y cantidades distintas de R09. No imprime conteo ni total; el esperado queda solamente en `expected.json`, que NO se envia a BBC.
- Perfil comprobado en SQL: Juan/admin, 573174442659. Datana sigue recepcion_cierre y Jobana alistador. Enviar a la linea del agente como documento PDF, sin texto adjunto, una sola vez; no borrar el envio mientras se observa la respuesta.
- Esperado: un NUEVO borrador de salida 3Q, nueve filas, 239 und; destinatario 3Q - MAQUILA EXTERNA QA, fecha 2026-09-06. Cantidades: TPBI 25, TRP 25, ETBOS60 19, LNTP60 19, ETRESI60 21, TPGG 33, TRG 33, LNTG120 33, ETRES120 31. Ningun lote/vencimiento aparece en este PDF: deben permanecer null, sin inventar datos del encabezado. Los lotes operativos se validan separadamente al preparar/confirmar la remision.
- Verificacion interna: ambas paginas renderizadas y revisadas; extractor nativo recupera nueve filas y todos los campos exactos. Caso nuevo prueba recuperacion cuando el modelo omite la ultima fila. Seis pruebas dirigidas aprobadas; suite completa 248/248, cero fallos. No se modifico la logica de aplicacion ni se necesita desplegar para este fixture.
- Base previa: referencia R10 inexistente; kardex 298, movimientos 307, checksum stock 21446.4850 y reservas 1440.8000. Los nueve SKU existen activos. No se requiere aumentar stock porque el documento solo crea borrador.
- Al recibir: registrar hora de envio/respuesta y webhook; exigir NATIVE_APPLIED; comparar cada SKU/cantidad/unidad y ausencias de lote/vencimiento en SQL y dashboard; comprobar PDF/hash original, un solo borrador, sin remision vinculada ni variacion de inventario. Si pasa, repetir el archivo para comprobar idempotencia de un alta creada enteramente con esta version. No corregir manualmente el borrador para dar por aprobada la extraccion.

### Pendientes reales por prioridad

| Prioridad | Paquete | Que falta comprobar o corregir |
|---|---|---|
| Alta | Documentos | D10: alta nueva 3Q y su reintento; OC nueva con todos sus lotes/vencimientos tras despliegue del lector compartido. R09 ya acredita lector en servidor y reintento 3Q, no alta nueva con esta version. |
| Alta | Produccion adicional | D05: consumir una sola vez la confirmacion de operacion adicional; repetirla no debe crear otra OP/reserva. OP 75/76 se conservan como evidencia, no iniciarlas. |
| Alta | Merma adicional | D06: recuperar el registro base en conversacion, pedir solo lo necesario y validar un unico movimiento ante reintentos. No llego a ejecutar la accion en la prueba. |
| Alta | Devolucion adicional | D07: recuperar contexto sin pedir id_item tecnico, respetar maximo retornable y comprobar idempotencia. No llego a ejecutar la accion en la prueba. |
| Media | Trazabilidad | D02: provocar paginacion real, separar reservas sin consumo de consumo real y unificar hora Bogota entre Kardex/dashboard/WhatsApp. UUID y trazabilidad inversa 3Q ya tienen repeticion aprobada. |
| Media | Totales y escala | D08 y resumen OC: separar gramos/unidades; resolver Entradas 0 frente a recepciones; validar mas de 100 filas para que el limite de consulta no trunque indicadores. Conteo de recepciones unicas ya aprobado. |
| Menor / reproduccion | Interfaz | Alias ambiguos en lista legible; reproducir manualmente el vaciado de vencimiento en correccion 3Q para distinguir fallo UI de automatizacion. Correccion/descarte auditados ya probados. |

### Cuando repetir la bateria completa

1. Ahora: cerrar alta documental nueva y reintento, luego corregir y repetir los casos dirigidos bloqueantes. No reiniciar todas las pruebas manuales mientras esos fallos conocidos sigan abiertos.
2. Despues: ejecutar una bateria integral final sobre una version fija, con dataset nuevo e identificable y tres perfiles configurados por bloques. Cubrir recepcion segura, produccion propia/reposicion/merma/cierre, IO, envio/recepcion parcial 3Q, despacho, devoluciones/cuarentena, trazabilidad, roles, notificaciones y dashboard. Incluir ausencias de datos, reintentos, concurrencia donde aplique y cotejo SQL antes/despues. Mantener desactivadas las decisiones de negocio no aprobadas.
3. Durante ajustes: suite automatizada segura completa en cada cambio de logica; repetir manualmente lo afectado. Ampliar la regresion si cambian servicios compartidos, permisos, reservas o transacciones. Las 248 pruebas locales no sustituyen WhatsApp/BBC ni aceptacion del cliente.
4. La bateria del cliente sin SIIGO real certifica el flujo WMS con datos de prueba, no la integracion contable productiva. Mantener esa validacion separada y coordinada con el responsable de SIIGO. No reabrir funciones fuera de alcance, como disposicion final oculta, para cerrar esta corrida.

No se declara sistema completo aprobado, ni se da un numero de pruebas restantes definitivo antes de resolver estos paquetes y desglosar su regresion. Las afirmaciones historicas de implementado en otros planes deben leerse junto con los resultados reales mas recientes de esta bitacora.

### D10 - Alta nueva R10 aprobada en los tres canales

- 2026-09-06, envio WhatsApp 14:15; RECEIVED 1472 a las 14:16:00 y PROCESSED 1473 a las 14:16:02 Bogota. Juan/admin envia PDF sin caption. Respuesta completa, sin JSON: nuevo borrador, nueve items, 239 unidades, PENDIENTE_REVISION.
- SQL: un unico borrador ID 19. Los nueve SKU y cantidades coinciden exactamente con expected.json, todos en und; lote y vencimiento null en todas las filas. Destinatario 3Q - MAQUILA EXTERNA QA y fecha 2026-09-06 correctos; sin OC ni remision vinculadas. No hubo correccion manual.
- Diagnostico real: NATIVE_APPLIED, model_rows 9, compact_rows 9, native_rows 9. Esta vez tanto modelo como lector devolvieron todas las filas.
- PDF original: 4026 bytes; SHA256 ee15f36050745b4c74632b785beece57b25cd27a3b16880eaecc8ebdbcba3d51 igual en archivo local, hash almacenado y contenido SQL.
- Dashboard Maquila 3Q > Documentos leidos: nueve filas/239 und y PDF descargable. Se requirio salir/volver a la pagina para refrescar el alta de WhatsApp; alternar pestanas internas no actualizo la lista. Observacion UX de refresco, no perdida de datos.
- Observacion no bloqueante para inventario: ciudad, entrega y recibe presentes en el encabezado no se trasladaron al borrador; NIT tambien ausente, aunque el usuario ya lo considera secundario. No declarar fidelidad de todos los metadatos por haber validado los items. Mantener en pendientes de lectura de cabecera/presentacion.
- Integridad: kardex 298, movimientos 307, checksum stock 21446.4850, reservas 1440.8000, sin cambios. APROBADA alta nueva para campos operativos definidos. Sigue pendiente reintento del mismo R10 y nueva OC con esta version; el reintento R09 ya esta aprobado.

### D02 - Limite de pagina y nuevo cotejo horario

- 2026-09-06, 14:19 Bogota. Juan/admin pide pagina 2 de TEST_AGENT-MPASH-FIFO-NEW. Respuesta controlada: pagina invalida, rango 1 a 1. Webhook 1474/1475, consulta rechazada sin escrituras operativas. APROBADO limite de pagina; NO acredita navegacion de un historial realmente multipagina.
- Lectura SQL para seleccionar caso: el lote con mas movimientos existentes tiene 18; no se insertaron historiales artificiales ni se redujo el umbral de 3400 caracteres para simular una aprobacion. Sigue pendiente un fixture suficientemente extenso para pagina 1/2/ultima y reconstruccion integra.
- 14:20-14:21, consulta DEMO-GOMAS-001. Se expandio Read more y se leyo hasta la ultima OP. Se confirmaron saldo 319.25 g y los ocho movimientos fisicos.
- FALLO de consistencia horaria persistente: consumo adicional OP 74, SQL texto 2026-09-05 14:45:34; Kardex muestra 14:45 y WhatsApp 09:45. Devolucion 5 g: Kardex 14:46 y WhatsApp 09:46. No elegir hora correcta sin revisar serializacion/zonas, aunque las operaciones son las mismas.
- FALLO de rotulado persistente: OP 63/64/65/66/71/75/76 figuran como ordenes que consumieron con neto 0. Separar asignacion/reserva de consumo efectivo. No se modifico inventario en estas consultas.

### D06 - Variante conversacional resuelve contexto, reintento duplica merma

- 2026-09-06, 14:21:49 Bogota. Juan/admin: `Registra una nueva merma adicional igual a MER-4ABBD46A. Es otro derrame de 5 gramos del mismo producto y lote, en la misma ubicacion.` (mensaje real con tildes).
- SQL previo: registro base de 5 g, SKU 00051-MPASH, lote QA-RX-0905-MPASH, ubicacion B16; saldo lote 1995 g. La variante explicita recupera producto/lote/ubicacion y crea MER-84D14B9F con un movimiento de -5, saldo 1990 g. No hubo que dictar SKU ni lote. APROBADA recuperacion en esta frase; la frase corta de las 12:42 sigue sin validacion positiva.
- Reenvio literal 14:22, procesado 14:23:03: crea MER-A6C5FC05, otros -5 g, saldo 1985 g. FALLO de idempotencia de la confirmacion adicional. Dos mensajes de prueba generaron dos mermas/10 g cuando el segundo era reintento del primero. Se detuvieron las repeticiones.
- Evidencia preservada, sin borrar ni compensar historicos. Corregir confirmacion adicional persistente/consumible antes de repetir un escenario nuevo. El riesgo es equivalente al ya comprobado en OP 75/76; resolver la causa comun, no solo la frase del prompt.
- Dashboard 14:22, actividad reciente muestra MER-84D14B9F como -5 u pese a ser gramos; continua D08 de unidades. No confundir disponibilidad agregada del producto en la respuesta con saldo de lote.

### D08 - Repeticion visual de indicadores

- 2026-09-06, 14:22 Bogota. Periodo 7 dias muestra 12 recepciones/6181 unidades recibidas y Entradas 0 u. La merma de 5 g se presenta como -5 u en actividad reciente; sumatorio de mermas tambien rotulado u.
- Resultado: FALLOS de presentacion/consistencia persistentes; no se certifica escala mayor de 100 filas ni se crean recepciones ficticias solo para inflar el conteo. Priorizar agregacion por unidad y consulta de totales sin truncamiento, luego validar carga con fixtures aislados.

### D07 - Variante conversacional y limite retornable

- 2026-09-06, 14:23:53 Bogota. Juan/admin: `Registra una devolucion adicional igual a DEV-D42BAF7B. Es otra unidad del mismo despacho y lote, con el mismo motivo, ubicacion y condicion.` (mensaje real con tildes).
- Base: despacho ID 49, item 41, SKU 00276-PTZNASHWA, lote DEMO-ENSAYO-FINAL-IO-ZENOVA-001; dos unidades despachadas y una devuelta. La segunda unidad era retornable.
- Resultado: DEV-B9C596FD, un nuevo lote L-DEV-00276-PTZNASHWA-B9C596FD, 1 und DISPONIBLE en B13, estado RECUPERABLE heredado de la solicitud. Un movimiento Kardex +1 y saldo 1. Historial dashboard confirma factura, cliente, lote origen/nuevo, ubicacion, cantidad, estado y actor Juan. APROBADA recuperacion del contexto para esta frase.
- Reenvio literal 14:25, webhook 1484/1485: REJECTED, despachadas 2/devueltas 2/maximo 0. SQL mantiene dos devoluciones del despacho con suma 2. APROBADO limite retornable y rechazo sin movimiento.
- Idempotencia NO aprobada: el reintento no devuelve la devolucion previamente creada, sino un error de exceso. El limite fisico evita una tercera unidad en este caso, pero no demuestra proteccion contra duplicado cuando quede mas saldo retornable. No repetir con mas stock hasta corregir la confirmacion consumible comun a OP, merma y devolucion.

### Cierre del bloque de pruebas 14:16-14:27

- Documentos: alta nueva R10 aprobada en WhatsApp/dashboard/SQL, sin correccion manual. Intento de reenvio desde Forward media en WhatsApp no abrio selector ni produjo mensaje; no se cuenta como prueba enviada. Sigue pendiente reenvio manual R10 (sin caption) y alta nueva OC. No hay otro webhook documental posterior al 1473.
- Integridad global final: mermas 27 (+2), devoluciones 26 (+1), kardex 301 (+3), movimientos 310 (+3), checksum stock 21437.4850 (delta numerico -9 por -10 g y +1 und; no mezclarlo como magnitud operativa), reserva 1440.8000 sin cambio. Los tres movimientos corresponden a las operaciones identificadas; la segunda merma es el duplicado detectado y preservado como evidencia.
- No se modificaron roles, prompts, codigo de aplicacion, Siigo ni configuracion; no se hizo push en este bloque. Anotaciones guardadas localmente. OP 75/76 no se ejecutaron ni se recreo un nuevo duplicado de produccion, porque el fallo ya estaba reproducido y no ha cambiado el codigo.
- Orden recomendado siguiente: corregir confirmacion adicional de un solo uso (D05/D06/D07), cubrirla automaticamente y repetir con fixtures nuevos; resolver horarios/rotulado/totales, validar paginacion con caso suficientemente extenso; cerrar PDFs pendientes; luego una bateria integral final sobre version fija. No acreditar los casos bloqueados con nuevos reintentos sobre la misma logica defectuosa.

### Correccion D05/D06/D07 y ajustes de materiales - 2026-09-06, 14:49-14:56 Bogota

- Confirmado en codigo: referencias de merma y devolucion ya son opcionales en dashboard y WhatsApp; las rutas generan AUTO-MER/AUTO-DEV. No confundir codigo nuevo con el lote/orden/despacho fisico obligatorio.
- Causa del duplicado: los booleanos confirmar_nueva_* omitian el detector semantico sin guardar que la confirmacion habia sido consumida. El ajuste de materiales de OP tenia el mismo patron y se incluyo en el arreglo.
- Implementada confirmacion durable por tipo/actor/base existente, hash de payload y resultado guardados en la misma transaccion de inventario. Reintento devuelve el resultado antes de consultar saldos o estados mutables; cambios de payload fallan cerrados. Dashboard conserva la base sin digitacion manual. Prompt aclara que el reintento conserva la base original, no el registro nuevo.
- 14:49 aprox.: comprobacion real MySQL con tablas temporales: commit, rollback, reintento por ID o numero, conflicto por payload; cero escrituras en tablas operativas. No se acredita concurrencia real entre conexiones con esa prueba.
- Migracion 30 aplicada a QA y verificada: tabla InnoDB, clave primaria tipo/usuario/base, sin modificar historicos ni inventario. Detalle en confirmaciones-adicionales.md.
- 14:56 aprox.: 266/266 pruebas locales, 18 nuevas de workflows completos con doble transaccional (replay, concurrencia simulada, rollback y conflicto); build frontend aprobado. Incluye prueba sin referencia de merma/devolucion y evita repetir notificacion de liberacion en replay.
- Pendiente de este bloque: publicacion/readback BBC y validacion real de nuevas confirmaciones en WhatsApp/dashboard/SQL. No se marcan aprobados los escenarios manuales solo por las pruebas automaticas. No se borraron OP 75/76 ni las mermas duplicadas historicas.
