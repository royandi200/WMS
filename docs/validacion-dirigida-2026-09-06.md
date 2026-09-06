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
