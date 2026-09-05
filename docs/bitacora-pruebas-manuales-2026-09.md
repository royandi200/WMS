# Bitacora de pruebas manuales WMS - septiembre 2026

Actualizado: 2026-09-04

## Objetivo y reglas

Registrar resultados, novedades y pendientes sin convertir cada observacion en un cambio aprobado. Complementa la [guia funcional](guia-funcional-y-validacion-integral-wms.md).

1. Antes de cada prueba, indicar objetivo, rol, datos y si Juan debe cargar un archivo. Esperar la carga antes de ejecutar.
2. Ejecutar una sola prueba; leer completos los mensajes, expandiendo `Read more` cuando aparezca.
3. Anotar resultado, evidencia, efecto en inventario y pendientes en esta bitacora antes del informe al usuario.
4. Entregar un informe corto y esperar aprobacion antes de la siguiente prueba.
5. Una prueba funcional correcta puede tener pendientes de usabilidad o auditoria. Aprobar su revision no autoriza automaticamente corregirlos.
6. No marcar un pendiente como resuelto sin cambio y verificacion documentados. Conservar tambien decisiones de no implementar o posponer.

## Contexto de la jornada 2026-09-04

- Entorno de desarrollo con datos de demostracion, sin inventario productivo del cliente.
- Canales: WhatsApp Web real, dashboard y consultas MySQL. Juan: admin; Datana: recepcion_cierre; Jobana: despacho. No se cambiaron roles durante estos casos.
- Referencia Git local observada: `17accea32bf2626655ebe0b8340465b42c605cfa`. No demuestra que ese sea el commit desplegado.
- Los resultados anteriores a la creacion de esta bitacora se consolidan retrospectivamente de la evidencia obtenida en esta tarea; no se reejecutaron al escribirla.
- No se reejecutaron suite automatizada ni build en esta jornada. Las cifras de otros documentos conservan sus fechas originales.

## Registro de pruebas

### MAN-001 - Consultas y permiso de recepcion

- Resultado: consultas de recepciones respondieron a admin y recepcion_cierre. Jobana, con rol despacho, no pudo preparar la recepcion ID 9.
- Evidencia: logs `1132-1139`; tras el rechazo no existia recepcion de OC 9.
- Inventario: sin cambios por estas consultas y rechazo.
- Pendiente: `P-002`, registro del rechazo con estado vacio en logs.

### MAN-002 - Recepcion IO y reintento

- Datos: OC `DEMO-CLIENTE-OC-IO` (ID 9), SKU `00276-PTZNASHWA`, 5 unidades; lote `DEMO-CLIENTE-IO-ZENOVA-001`, vencimiento `2027-11-29`, ubicacion `B13`.
- Resultado: preparacion, resumen, confirmacion y repeticion por WhatsApp correctos. Antes de confirmar no existia el nuevo lote; repetir no duplico el ingreso.
- Evidencia: logs `1140-1147`; recepcion ID 67 `REC-OC-9-001`, OC cerrada, stock ID 150, un Kardex `INGRESO_RECEPCION` de +5 con usuario 18. Historico de recepciones visible en dashboard.
- Inventario: lote 0 -> 5; total del producto 27 -> 32.
- Limite: se uso una OC existente; no se probo una nueva carga PDF en esta corrida.
- Pendientes: `P-003`, `P-004` y `P-005`.

### MAN-003 - Despacho IO y reintento

- Preparacion: fixture local con `scripts/qa/prepare-demo-dispatch.js`, escenario `io`, corrida `QA-WA-20260904`; dry-run y aplicacion explicita. Factura sintetica, sin llamada remota a Siigo y con notificaciones desactivadas.
- Datos: despacho ID 50 `DSP-SIIGO-FV-DEMO-QA-WA-2026`, factura `FV-DEMO-QA-WA-20260904-IO-001`, 2 unidades del lote de MAN-002.
- Resultado: consulta mostro lote y B13; Jobana confirmo y repitio. La segunda confirmacion no modifico inventario.
- Evidencia: logs `1148-1153`; despacho en estado despachado, un Kardex `DESPACHO` de -2 con usuario 20; stock del lote 3, reserva 0. Inventario del dashboard concilio.
- Inventario: reserva inicial de 2 sin salida fisica; al confirmar lote 5 -> 3 y total del producto 32 -> 30. Otros lotes no cambiaron.
- Limites: no valida importacion real desde Siigo ni notificacion proactiva. Se abrio el historico de despachos, pero su contenido final no se reviso antes de la pausa.
- Pendientes: `P-001` y `P-006`.

### MAN-004 - Trazabilidad IO y lectura completa

- Resultado: consulta por admin del lote de MAN-002 enlaza OC/proveedor, recepcion +5, despacho -2/cliente, saldo 3 y B13. Logs `1154-1155`.
- Novedad de metodo: inicialmente se leyo texto completo expuesto por la interfaz de accesibilidad, sin expandir la burbuja. Eso no bastaba para validar la lectura visual completa.
- Verificacion posterior: se hizo clic en `Read more` del mensaje real y se reviso hasta el final, incluyendo origen documental y las secciones de produccion/BOM. No se envio otra consulta ni se modifico inventario en esta verificacion visual.
- Pendiente: `P-007`. Juan autorizo continuar con la siguiente prueba; esto no aprueba implementar la mejora.

### MAN-005 - Historico del despacho IO en dashboard

- Fecha: 2026-09-04. Rol: Admin WMS en dashboard. No se requirio PDF ni cambio de roles.
- Objetivo: cerrar la revision pendiente del historico de MAN-003, cotejando factura, cliente, lote y cantidad con SQL.
- Resultado: correcto con observaciones de presentacion. La tabla muestra una fila del despacho ID 50, factura `FV-DEMO-QA-WA-20260904-IO-001`, cliente `WMSQA260721 Cliente`, SKU `00276-PTZNASHWA`, lote `DEMO-CLIENTE-IO-ZENOVA-001`, ubicacion B13, 2 unidades y estado DESPACHADO. Pendiente mostrado: 0.
- Evidencia: lectura de la tabla y captura visual de Despachos > Historico; SELECT de despachos ID 50, despacho_items, stock ID 150 y Kardex por referencia de factura. El item tiene cantidad_sol=2 y cantidad_des=2; existe un solo Kardex DESPACHO -2 con saldo 3 y usuario 20.
- Inventario: stock del lote sigue en 3, reservada=0, igual al cierre de MAN-003. Prueba solo de consulta; no se confirmo otra salida ni se llamo a Siigo.
- Novedades: fecha visible `2026-09-04 15:33`, frente a `10:33` en WhatsApp (P-003 ampliado a despachos); columna RESERVADO muestra 2 pese a reserva actual 0 (P-008).
- Limites: no se auditaron todas las filas historicas ni se diagnostico el origen del valor RESERVADO. No demuestra que exista una reserva activa incorrecta.
- Revision de Juan: autorizo avanzar a la siguiente prueba. Los pendientes no quedan aprobados para implementacion.

### MAN-006 - Devolucion IO a cuarentena desde WhatsApp

- Fecha: 2026-09-04, 11:00 de Bogota. Se verificaron roles activos en SQL: Juan admin, Datana recepcion_cierre, Jobana despacho; sin cambios. No se requirio archivo.
- Precondiciones: despacho ID 50 confirmado por 2 unidades, sin devoluciones previas. Lote origen con 3 unidades disponibles; producto completo con 30 disponibles y 0 reservadas. Ubicacion CUAR-C-1-01 activa en bodega 1 (ID 27).
- Mensaje enviado una sola vez desde Jobana: `Registra una devolucion de 1 unidad de Zenova Ashwagandha del despacho ID 50, lote original DEMO-CLIENTE-IO-ZENOVA-001, cliente WMSQA260721 Cliente. Estado cuarentena por empaque danado, en CUAR-C-1-01. Referencia de devolucion QA-WA-20260904-DEV-001.` En WhatsApp se usaron acentos normales.
- Resultado: PARCIAL. Registro, aislamiento del disponible y vinculos correctos; consulta de inventario presenta inconsistencias descritas en P-009 y P-010.
- WhatsApp: respuesta completa, sin JSON ni boton Read more en esta respuesta. Confirma DEV-749326EA, cantidad 1, cliente, factura, despacho, lote origen, nuevo lote, ubicacion y CUARENTENA (no disponible). Alias Zenova Ashwagandha e ID 50 se resolvieron correctamente.
- SQL: devolucion ID 23, referencia QA-WA-20260904-DEV-001, despacho_id=50, despacho_item_id=42, usuario_id=20. Recepcion ID 68 REC-DEV-749326EA completada, item ID 99 con cantidad_rec=1. Nuevo lote L-DEV-00276-PTZNASHWA-749326EA con qty_initial=1, qty_current=1, estado CUARENTENA y vencimiento conservado 2027-11-29.
- Inventario: las tres filas previas de stock permanecen 24, 3 y 3, sin reservas; no se inserto una fila stock para el lote de cuarentena. El lote origen no se incremento. Hay 30 unidades disponibles y otra unidad documentada en lots como cuarentena.
- Kardex: un movimiento DEVOLUCION para el lote nuevo, qty=0, balance_after=30, referencia devolucion:DEV-749326EA, actor 20. Logs 1156 RECEIVED y 1157 PROCESSED para GESTION_DEVOLUCION.
- Dashboard: tras Actualizar, el historico de devoluciones muestra DEV-749326EA, factura/referencia, cliente, producto, ambos lotes, CUAR-C-1-01, cantidad 1, CUARENTENA y Jobana. Hora mostrada 16:00, frente a 11:00 en WhatsApp (amplia P-003).
- Dashboard > Buscar producto: disponible 30, reservado 0, bloqueado 0, total 30; omite el nuevo lote. Movimientos recientes muestra DEVOLUCION 0 y SALDO DEL LOTE 30 para el lote de 1 unidad. Verificado tambien mediante captura visual.
- Limites: no se probo reintento de devolucion, exceso acumulado, destruccion, recuperacion ni intento de reservar el lote bloqueado. No se cambiaron codigo, roles, configuracion ni Siigo.
- Revision de Juan: autorizo continuar, conservando resultado parcial y pendientes abiertos. Se acordo evaluar las referencias tecnicas al terminar la bateria, no corregirlas ahora.

### MAN-007 - Reenvio identico de devolucion sin duplicacion

- Fecha: 2026-09-04, 11:14 de Bogota. Jobana, rol despacho activo confirmado en SQL; sin cambios de roles ni archivos.
- Accion: se envio una vez mas el mensaje completo de MAN-006, con la misma referencia QA-WA-20260904-DEV-001, producto, despacho ID 50, lote origen, cantidad 1 y condicion CUARENTENA.
- Resultado: CORRECTO para reintento secuencial identico. WhatsApp respondio: `La devolucion DEV-749326EA ya estaba registrada. No se modifico inventario.` Respuesta completa revisada en la burbuja y mediante captura; sin JSON ni Read more.
- Evidencia: logs 1158 RECEIVED y 1159 PROCESSED, accion GESTION_DEVOLUCION. SQL antes/despues: sigue una unica devolucion del despacho 50 (ID 23), recepcion ID 68 REC-DEV-749326EA con un item de 1 unidad, y un solo movimiento Kardex asociado. No se duplicaron esos registros.
- Inventario antes/despues: lote original 3 disponibles; lote devuelto 1 en CUARENTENA; stock del producto 30 y reserva 0. No hubo cambios de cantidades por el reenvio.
- Novedad tecnica: la primera consulta de roles fallo con ECONNRESET; el reintento de lectura funciono antes del envio. Se registra como incidente transitorio de conexion MCP, no como fallo confirmado del WMS.
- Pendientes relacionados: P-011 sigue abierto (no se probo experiencia sin referencia). P-009/P-010 no se corrigieron ni se dan por resueltos por esta prueba.
- Limites: no valida concurrencia, repeticion con otra referencia, cambio de contenido con igual referencia ni exceso acumulado. No se revalido dashboard en esta prueba; evidencia de idempotencia obtenida por WhatsApp y SQL.
- Revision de Juan: autorizo continuar con la siguiente prueba; pendientes anteriores permanecen abiertos.

### MAN-008 - Rechazo de devolucion por exceso acumulado

- Fecha: 2026-09-04, 11:20 de Bogota. Rol despacho de Jobana verificado activo en SQL; sin cambios de roles ni archivos.
- Precondiciones: despacho ID 50, item ID 42, producto 104, lote DEMO-CLIENTE-IO-ZENOVA-001, cantidad_des=2; devolucion previa DEV-749326EA por 1. Saldo retornable esperado: 1.
- Accion: se envio una solicitud de devolucion de 2 unidades de Zenova Ashwagandha, mismo despacho/lote/cliente, a CUARENTENA por empaque danado en CUAR-C-1-01, con referencia NUEVA QA-WA-20260904-DEV-EXCESO-001. Usar referencia nueva permite probar acumulacion, no solo deduplicacion.
- Resultado: CORRECTO. Respuesta completa de WhatsApp: `Solo quedan 1 unidades retornables de ese lote y despacho`. Revisada en burbuja y captura, sin texto truncado ni JSON.
- Evidencia: log 1160 RECEIVED y 1161 REJECTED, GESTION_DEVOLUCION; error con statusCode=409 y el mismo mensaje. El rechazo reconoce la devolucion anterior aun cuando la nueva solicitud por si sola no excede las 2 despachadas.
- SQL despues: sigue solo la devolucion ID 23 por 1 del despacho 50; referencia EXCESO inexistente, ninguna recepcion nueva posterior a ID 68. Se mantienen los cuatro lotes del producto con cantidades 24, 3, 3 y 1 en cuarentena; Kardex conserva 6 movimientos para producto 104, igual que antes.
- Inventario antes/despues: disponible 30, reservado 0, cuarentena 1; lote original conserva 3. No se registraron cantidades adicionales ni devolucion parcial automatica.
- Novedad: P-012, redaccion singular/plural del rechazo y oportunidad de explicar el calculo. Sin correcciones en esta prueba.
- Limites: no valida dos solicitudes simultaneas, recuperacion/destruccion, otros lotes ni otros canales. Dashboard no se revalido en este caso negativo; evidencia WhatsApp/SQL.
- Revision de Juan: autorizo continuar con la siguiente prueba; pendientes anteriores permanecen abiertos.

### MAN-009 - Devolucion destinada a destruccion

- Fecha: 2026-09-04, envio 11:22 y respuesta 11:23 de Bogota. Jobana, rol despacho activo verificado. Sin archivos ni cambios de roles.
- Precondiciones: despacho ID 50 por 2 unidades, 1 ya devuelta a cuarentena. Se dispone de 1 unidad retornable. Referencia QA-WA-20260904-DEV-DEST-001 inexistente antes del envio.
- Accion: una solicitud por WhatsApp de devolucion de 1 unidad de Zenova Ashwagandha, despacho ID 50, lote original DEMO-CLIENTE-IO-ZENOVA-001, cliente WMSQA260721 Cliente, estado destruccion por `envase roto y producto contaminado`, ubicacion CUAR-C-1-01 y referencia QA-WA-20260904-DEV-DEST-001.
- Resultado: PARCIAL. La devolucion queda trazada y fuera del disponible; se pierde el motivo en el registro operativo (P-013) y falta explicitar la disposicion pendiente en mensajes/historico (P-014).
- WhatsApp: DEV-D5DEBB70 registrada; cantidad 1, factura, despacho, cliente, SKU, lote original/nuevo y CUAR-C-1-01 correctos. Destino DESTRUCCION (no disponible). Mensaje completo leido en burbuja y captura, sin JSON ni Read more.
- SQL: devolucion ID 24, despacho_item_id=42, usuario_id=20, estado DESTRUCCION, ubicacion_id=27; recepcion ID 69 REC-DEV-D5DEBB70 completada con 1 unidad. Nuevo lote L-DEV-00276-PTZNASHWA-D5DEBB70, qty_current=1, PENDIENTE_DISPOSICION, vencimiento 2027-11-29.
- Inventario: stock del producto se mantiene en 30 y reserva 0. Los lotes disponibles conservan 24, 3 y 3; cuarentena conserva 1; se agrega 1 pendiente de disposicion. No se afirma destruccion fisica ejecutada.
- Conciliacion de retornos: 2 despachadas, 2 devueltas acumuladas, 0 retornables restantes. Un nuevo Kardex DEVOLUCION de qty=0, balance_after=30, usuario 20 y referencia devolucion:DEV-D5DEBB70; mantiene el problema semantico P-010, no representa saldo propio de ese lote.
- Evidencia de comunicacion: logs 1162 RECEIVED y 1163 PROCESSED, GESTION_DEVOLUCION. El motivo completo aparece en body/text/query dentro de info, pero params omite motivo/observaciones y devoluciones.observaciones queda NULL. El texto existe en el log, no en la observacion operativa.
- Dashboard: tras Actualizar, Historico muestra DEV-D5DEBB70, factura/referencia, cliente, producto, ambos lotes, CUAR-C-1-01, 1 unidad, DESTRUCCION y Jobana. Muestra 16:23 frente a 11:23 en WhatsApp, otro caso de P-003.
- Limites: no se ejecuta ni valida destruccion fisica, autorizacion final o certificado de disposicion. No se probo reintento de esta devolucion ni reingreso recuperable. No se revalido Buscar producto en este caso. Sin cambios de codigo ni Siigo.
- Revision de Juan: autorizo continuar; las observaciones no quedan aprobadas para implementacion.

### MAN-010 - Devolucion recuperable con reingreso disponible

- Fecha: 2026-09-04, 11:29 de Bogota. Jobana, rol despacho activo verificado en SQL. Sin archivos ni cambios de roles.
- Precondiciones: se cambia al despacho ID 49 DSP-SIIGO-FV-DEMO-IO-001, factura FV-DEMO-IO-001, porque ID 50 agoto su saldo retornable. Item ID 41, producto 104, lote DEMO-ENSAYO-FINAL-IO-ZENOVA-001, 2 despachadas y ninguna devolucion previa. B13 activa, ID 59, bodega 1. Referencia nueva QA-WA-20260904-DEV-RECUP-001.
- Accion: una solicitud por WhatsApp de 1 unidad de Zenova Ashwagandha del despacho 49 y lote indicado, cliente WMSQA260721 Cliente, estado recuperable, producto sellado/en buen estado/devuelto por pedido equivocado, ubicacion B13 y referencia anterior.
- Resultado: PARCIAL. Reingreso y aislamiento respecto de los lotes bloqueados correctos; se reproducen pendientes de observaciones y consulta ya identificados.
- WhatsApp: DEV-D42BAF7B registrada con 1 unidad, origen, factura, cliente, nuevo lote y B13 correctos; destino Stock disponible. Se leyo la respuesta completa y se verifico visualmente, sin JSON ni Read more.
- SQL: devolucion ID 25, despacho_id=49, despacho_item_id=41, usuario_id=20, RECUPERABLE, ubicacion_id=59. Recepcion ID 70 REC-DEV-D42BAF7B completada con 1 unidad. Stock ID 151 y lote L-DEV-00276-PTZNASHWA-D42BAF7B con 1 unidad disponible, reserva 0, vencimiento 2027-11-30 igual al original.
- Inventario antes/despues: disponible 30 -> 31; las tres filas anteriores de stock conservan 24, 3 y 3. No se incrementa el lote original: se crea uno vinculado. Cuarentena conserva 1 y PENDIENTE_DISPOSICION conserva 1; no se liberaron ni transformaron estos lotes. Resultado fisico documentado: 31 disponibles mas 2 no disponibles.
- Kardex: un movimiento DEVOLUCION +1, reference devolucion:DEV-D42BAF7B, usuario 20, balance_after=31. Ese 31 es total de producto, no saldo propio del lote (P-010 reproducido).
- Evidencia: logs 1164 RECEIVED y 1165 PROCESSED, GESTION_DEVOLUCION. Devoluciones.observaciones=NULL pese al motivo declarado (P-013 reproducido; no se inspecciono params en esta prueba).
- Dashboard: historico muestra DEV-D42BAF7B, factura/referencia, ambos lotes, cliente, B13, 1, RECUPERABLE y Jobana; fecha 16:29 frente a 11:29 WhatsApp (P-003 reproducido). Buscar producto muestra disponible 31, reserva 0 y nuevo lote de 1 unidad en B13. Movimiento +1 visible, pero SALDO DEL LOTE=31 (P-010). BLOQUEADO=0 y TOTAL=31 omiten los lotes no disponibles previamente registrados (P-009 reproducido).
- Pendientes aplicables no reprobados: P-011, el operario sigue dependiendo de referencia tecnica manual. No se genera otro hallazgo por la misma causa.
- Limites: se valida devolucion directamente recuperable, no liberacion de una cuarentena existente. No se probo reintento de esta variante, nuevo despacho desde el lote devuelto, concurrencia ni politicas de aprobacion de calidad. Sin correcciones de codigo, datos anteriores o Siigo.
- Revision de Juan: autorizo continuar; pendientes anteriores permanecen abiertos.

### MAN-011 - Misma referencia de devolucion con cantidad diferente

- Fecha: 2026-09-04, envio 11:39 y respuesta 11:40 de Bogota. Jobana, rol despacho activo verificado. Sin archivos ni cambios de roles.
- Precondiciones: devolucion ID 25 DEV-D42BAF7B por 1 unidad recuperable, referencia QA-WA-20260904-DEV-RECUP-001, despacho ID 49, recepcion ID 70. Stock del producto 31, reserva 0, Kardex 8 movimientos.
- Accion: repetir el mensaje de MAN-010 conservando referencia, producto, lote, despacho, condicion y ubicacion, pero cambiando cantidad de 1 a 2. No se solicito editar la devolucion anterior.
- Esperado de seguridad de datos: no escribir cambios; distinguir conflicto de contenido de un reintento identico y explicar cantidad registrada frente a solicitada.
- Resultado: PARCIAL. No se duplico ni modifico inventario, pero no se identifico el conflicto al usuario. Respuesta completa: `La devolucion DEV-D42BAF7B ya estaba registrada. No se modifico inventario.` Verificada en burbuja y captura, sin JSON ni truncamiento.
- Evidencia: log 1166 RECEIVED contiene params.cantidad=2 dentro de info; 1167 PROCESSED devuelve context.return.cantidad=1.000 y already_completed=true. No se rechazo como conflicto; se trato como operacion ya completada.
- SQL antes/despues: unica devolucion del despacho 49 sigue en ID 25 por 1; recepcion ID 70 conserva 1, sin nuevas recepciones posteriores; Kardex sigue en 8 movimientos para producto 104. Lotes sin cambios: disponibles 24,3,3,1; cuarentena 1; pendiente de disposicion 1. Stock 31, reserva 0.
- Revision focal de codigo local: api/_lib/returns-workflow.js, createCustomerReturn, devuelve existingReturn por referencia con already_completed=true antes de comparar contenido operativo. Concuerda con el comportamiento observado; no se modifico codigo.
- Pendiente nuevo: P-015, ligado a P-011. Diferenciar conflicto de contenido y deduplicacion identica sin abrir una via de modificacion silenciosa.
- Novedad de herramientas: primera consulta SQL de roles fallo con ECONNRESET; reintento de lectura exitoso antes de enviar. Ya observado en MAN-007; no se atribuye al runtime WMS.
- Limites: no valida cambios de producto, cliente, lote o estado, ni concurrencia. Aunque solo quedaba 1 unidad retornable, no se alcanzo el rechazo por exceso: el resultado ya-existente tiene prioridad. MAN-008 cubrio exceso con referencia nueva. Dashboard no se revalido.
- Revision de Juan: autorizo continuar; los pendientes siguen abiertos.

### MAN-012 - Capacidad de produccion propia por alias

- Fecha: 2026-09-04, 11:49 de Bogota. Juan, rol admin activo verificado; no se cambiaron roles. Sin archivos ni escritura operativa solicitada.
- Consulta enviada: `Cuantos tarros de ashwagandha 60 podemos producir con los materiales disponibles?` En WhatsApp se usaron signos y acentos normales. Se resolvio el alias a SKU 00102-PTASH60, producto ID 74, modalidad PR.
- Resultado: CORRECTO con mejora de presentacion. WhatsApp responde capacidad 14 unidades y detalla cinco componentes. Mensaje completo leido y verificado visualmente, sin JSON ni Read more.
- Cotejo BOM de etapa PRODUCCION: tapa 00001-TPBI=1/ud, tarro 00006-TRP=1/ud, etiqueta 00017-ETASH60=1/ud, liner 00035-LNTP60=1/ud, gomas 00051-MPASH=180 g/ud.
- SQL elegible BG-PPAL (bodega activa ID 1): tapas 14 -> capacidad 14; tarros 254 -> 254; etiquetas 18 -> 18; liners 254 -> 254; gomas 8204.25 g -> floor(8204.25/180)=45. Minimo=14, limitado por tapas. Todos los valores coinciden con la respuesta.
- Regla cotejada contra codigo local manufacturing-capacity.js y datos: lotes DISPONIBLE, ubicacion activa de la misma bodega, saldo positivo descontando reserva y vencimiento no anterior a fecha SQL. No equivale al stock bruto.
- Novedad de datos de ensayo: etiquetas TEST_AGENT-ETASH60 tienen 250 de stock y 100 reservadas sin maestro lots coincidente; quedan excluidas. En gomas se excluyen lotes vencidos y 177 unidades en lotes sin ubicacion, ademas de respetar reservas. No se repararon ni eliminaron datos de prueba. Documentar estas exclusiones evita confundir capacidad con saldo bruto.
- Evidencia: logs 1168 RECEIVED y 1169 PROCESSED para CONSULTAR_CAPACIDAD_FABRICACION. SQL antes/despues de stock por insumo (cantidad/reserva): 19=14/0; 22=254/0; 27=268/100; 51=254/0; 60=8805.1/100. Sin cambios; Kardex conserva 65 movimientos entre esos insumos.
- Pendiente nuevo: P-016. No se reprodujeron en esta consulta los fallos de devoluciones y no se marcan corregidos.
- Incidente de herramientas: ECONNRESET inicial en consulta de rol, resuelto al reintentar lectura; no se atribuye al WMS. Una exploracion SHOW TABLES fallo por LIMIT agregado por MCP; se uso el esquema confirmado en codigo, sin efectos en datos.
- Limites: no se creo OP ni se valido liberacion, notificacion, alistamiento o consumo. No se ensayaron simultaneidad ni todos los estados excluidos mediante fixtures nuevos; es cotejo de la capacidad con los datos actuales de BG-PPAL.
- Revision de Juan: autorizo continuar; los pendientes siguen abiertos.

### MAN-013 - Rechazo de OP superior a capacidad

- Fecha: 2026-09-04, envio 11:52 y respuesta 11:53 de Bogota. Juan, rol admin activo verificado. Sin archivos ni cambios de roles.
- Precondicion: MAN-012 calculo 14 tarros por tapas disponibles; antes del envio se verifico que stock y reservas seguian iguales. Ordenes existentes: 41, maximo ID 68; Kardex de los cinco insumos: 65 movimientos.
- Mensaje: `Vamos a producir 15 tarros de ashwagandha 60 para stock de seguridad.` Sin SKU ni referencia tecnica manual; finalidad explicita para evitar otra pregunta de origen.
- Resultado: CORRECTO en bloqueo, con mejora de mensaje. WhatsApp respondio `Stock insuficiente para liberar la orden`. Texto completo revisado en burbuja y captura, sin JSON ni Read more.
- Evidencia: log 1170 RECEIVED, LIBERAR_ORDEN_PRODUCCION, params id_producto_final=00102-PTASH60, cantidad_planificada=15 y origen_tipo=STOCK_SEGURIDAD; log 1171 REJECTED, statusCode=409. Reconocimiento de producto, cantidad y finalidad correctos.
- SQL despues: siguen 41 ordenes y maximo ID 68. Stock cantidad/reserva por insumo sigue: 19=14/0; 22=254/0; 27=268/100; 51=254/0; 60=8805.1/100. Kardex sigue en 65 movimientos. No hubo nueva OP, consumo ni cambio de reservas.
- Novedad vinculada a P-016: rechazo generico no explica que se requieren 15 tapas y solo hay 14 (faltante 1). Codigo local production-workflow.js calcula shortages antes de insertar la orden; mensaje/log de error observados no exponen ese detalle. Se propone mostrar faltante especifico y capacidad posible sin reducir la orden automaticamente.
- Limites: no se probo crear al maximo exacto, concurrencia, notificaciones ni nueva OP exitosa. La ausencia de cambios se cotejo por SQL, no por navegacion adicional del dashboard. No se aplicaron correcciones.
- Revision de Juan: autorizo continuar; pendientes abiertos sin correcciones aprobadas.

### MAN-014 - Liberacion de OP valida, reservas y aviso al alistador

- Fecha: 2026-09-04, 11:56 de Bogota. Sin archivos.
- Configuracion: Jobana ID 20 cambia de despacho a alistador mediante scripts/qa/set-demo-user-role.js, actor Juan, con log de autorizacion. Se verifico SQL despues: Juan admin, Jobana alistador, Datana recepcion_cierre, todos activos. Jobana queda alistador para las proximas pruebas de produccion; no se restaura despacho aun.
- Precondicion: capacidad disponible 14; no habia usuarios activos alistador antes del cambio. Se revisaron stock elegible y orden FEFO antes de solicitar 3 unidades.
- Mensaje de Juan: `Vamos a producir 3 tarros de ashwagandha 60 para stock de seguridad.` Sin SKU, codigo ni referencia manual.
- Resultado: CORRECTO con observaciones. Se crea una sola OP ID 69 OP-20260904-000069, producto 74 / 00102-PTASH60, cantidad_planeada=3, origen STOCK_SEGURIDAD, APROBADA, fase F0 y materiales_conf_en=NULL. Ordenes totales 41 -> 42; creado_por=5.
- Reservas SQL / BOM: tapas=3, tarros=3, etiquetas=3, liners=3, gomas=540 g. Ocho asignaciones: tapas 2 RECINT-60-82-01 en PPAL-A-1-01 y 1 RECINT-64-90-01 en A8; tarros 2 RECINT-60-83-01 en PPAL-A-1-01 y 1 DEMO-MAPA-A11-00006-TRP en A11; etiquetas 3 RECINT-60-84-01 en PPAL-A-1-01; liners 2 RECINT-60-85-01 en PPAL-A-1-01 y 1 DEMO-MAPA-A14-00035-LNTP60 en A14; gomas 540 de BEMO-GOMAS-E2E-001 en B16, vence 2026-09-15 (anterior a los otros lotes elegibles).
- Antes/despues: cantidades fisicas de las ocho filas seleccionadas no cambian; reservas de esas filas pasan de 0 a las cantidades anteriores. Kardex de insumos sigue en 65 movimientos. No se confirma alistamiento ni se consume material. Produccion_materiales contiene cinco componentes con cantidades teoricas/reservadas coincidentes.
- WhatsApp admin: muestra ID 69, producto/nombre, cantidad interpretada 3, destino y las ocho asignaciones. WhatsApp Jobana: recibe proactivamente Nueva orden para alistamiento, OP, producto, 3 und y las ocho asignaciones. Ambos Read more se expandieron; mensajes leidos completos y finales verificados visualmente. No se envio una confirmacion de inicio.
- Dashboard: la vista abierta antes de terminar la operacion no tenia aun la OP; tras recarga muestra OP69, stock seguridad, plan3, real0, sin lote PT, F0, Aprobada. Hora16:56 frente a11:56 en WhatsApp, reproduce P-003. No se diagnostico actualizacion automatica como fallo.
- Evidencia: logs 1172 RECEIVED y 1173 PROCESSED, LIBERAR_ORDEN_PRODUCCION; SQL orden69, produccion_materiales y stock IDs124,142,125,130,126,127,131,146; entrega de aviso observada directamente en WhatsApp de Jobana.
- Pendientes: P-003 reproducido; P-017 nuevo para legibilidad del aviso al alistador, relacionado con P-016 pero especifico de notificaciones. Los nombres del mensaje admin si estan presentes; no generalizar la omision a ambos canales.
- Observacion de Juan durante la revision: el mensaje al admin termina con `Cuando esten listos, confirma materiales de la orden ID 69`, aunque la responsabilidad operativa corresponde al alistador. Ampliar P-017 para adaptar el siguiente paso al destinatario: informar al admin que queda pendiente de confirmacion del alistador; pedir esa confirmacion al alistador. Es un ajuste propuesto de comunicacion, no una conclusion sobre permisos tecnicos ni una autorizacion para modificarlos.
- Limites: no valida inicio/consumo, reintento de liberacion, concurrencia, fecha resultante del PT ni cierre. No se comprobo ausencia de mensajes a todos los demas roles. Sin cambios de codigo ni llamadas Siigo.
- Revision de Juan: autorizo continuar con la siguiente prueba. P-017 ampliado con su observacion; no se aplicaron correcciones.

### MAN-015 - Confirmacion de materiales, consumo e inicio de produccion

- Fecha: 2026-09-04, 12:10-12:11 de Bogota. Sin archivos. Una sola solicitud operativa; sin reintento ni cierre.
- Roles verificados antes de enviar: Juan ID5 admin, Jobana ID20 alistador, Datana ID18 recepcion_cierre; todos activos. No se cambiaron roles.
- Precondicion SQL: OP69 OP-20260904-000069 APROBADA/F0, plan3, materiales_conf_en=NULL. Ocho filas stock reservadas segun MAN-014; Kardex de productos19,22,27,51,60 contaba65 movimientos. Primera lectura MCP dio ECONNRESET; reintento de lectura recuperado, sin atribuirlo al WMS.
- Mensaje enviado desde WhatsApp de Jobana: `Ya aliste los materiales de la orden ID 69` (con tilde en aliste). No se uso el codigo largo ni se dictaron nuevamente los insumos.
- Resultado: CORRECTO con observaciones de claridad. OP69 EN_PROCESO/F1, materiales_conf_en=2026-09-04T17:11:04Z. Dashboard, tras recarga, muestra En proceso/F1, plan3, real0, sin lote PT. La hora de creacion16:56 mantiene P-003; no confundirla con la hora de inicio12:11.
- Descuento comprobado por SQL: 3 tapas, 3 tarros, 3 etiquetas, 3 liners y 540 g de gomas. Stock IDs124 y125:2->0; ID126:8->5; ID127:2->0; IDs130 y131:240->239; ID142:12->11; ID146:1460->920. Las ocho reservas quedan0. Lots.qty_current coincide con stock; los tres lotes consumidos totalmente quedan AGOTADO.
- Auditoria: ocho movimientos CONSUMO_MATERIAL, referencia produccion:OP-20260904-000069, user_id20, cantidades -2/-1 por materiales repartidos, -3 etiquetas y -540 gomas. Kardex65->73. Logs1174 RECEIVED y1175 PROCESSED, accion CONFIRMAR_MATERIALES_PRODUCCION.
- WhatsApp: Jobana recibe Materiales confirmados, Orden en proceso y las ocho cantidades por lote. Juan y Datana reciben Produccion iniciada, producto, plan3, origen stock seguridad, confirmante Jobana, hora12:11, ocho asignaciones y EN_PROCESO. Se leyeron las burbujas completas: Read more del admin y Leer mas de Datana expandidos hasta el estado final; respuesta de Jobana completa sin corte. No se infirio entrega solo desde logs o vistas previas.
- Pendiente relacionado P-017: respuesta a Jobana lista solo lote/cantidad; no identifica material, unidad ni ubicacion. Avisos a Juan y Datana incluyen SKU/lote/ubicacion pero no nombre del material ni unidad (por ejemplo Cantidad:540 sin g). Ampliar revision de plantillas al inicio, no solo liberacion. No hay evidencia de descuento incorrecto por esta omision de texto.
- Limites: no valida idempotencia de confirmacion, concurrencia, reposicion, merma ni cierre. No se verifico politica de refresco automatico del dashboard. Sin cambios de codigo, llamadas Siigo, commit ni push.
- Revision de Juan: autorizo continuar con la siguiente prueba; observaciones de P-017 siguen abiertas.

### MAN-016 - Reintento de confirmacion de materiales sin doble consumo

- Fecha: 2026-09-04, 12:17 de Bogota. Sin archivos ni cambios de roles. SQL verifica Juan admin, Jobana alistador y Datana recepcion_cierre.
- Precondicion: OP69 OP-20260904-000069 EN_PROCESO/F1, materiales_conf_en=2026-09-04T17:11:04Z, ocho movimientos de consumo originales. Stock IDs124,125,126,127,130,131,142,146 con cantidades0,0,5,0,239,239,11,920 respectivamente; todas sus reservas0.
- Accion: Jobana envia nuevamente `Ya aliste los materiales de la orden ID 69` (con tilde en aliste), igual que MAN-015, mediante WhatsApp real. Una repeticion secuencial, no simultanea.
- Resultado: CORRECTO. Burbuja completa: `Los materiales de OP-20260904-000069 ya estaban confirmados. No se modifico inventario.` Sin JSON ni texto cortado; no requiere Read more.
- SQL antes/despues: mismas ocho cantidades y reservas; OP conserva estado, fase y fecha original de confirmacion. Kardex de referencia produccion:OP-20260904-000069 sigue en8 movimientos, todos de17:11:01Z a17:11:04Z; no se generan consumos por el reintento.
- Evidencia: logs1176 RECEIVED y1177 PROCESSED para CONFIRMAR_MATERIALES_PRODUCCION. Respuesta context.production_confirmation.already_confirmed=true y consumed=[].
- Notificaciones: chats del admin y Datana cotejados antes y despues de procesarse el reintento; ultimo aviso de inicio sigue siendo el de12:11. No se observaron duplicados en esa ventana. Lectura complementaria del codigo local production-workflow.js: retorna already_confirmed antes de consumir y antes de notifyRoles; no demuestra por si sola la version desplegada.
- Pendientes: sin hallazgos nuevos. P-017 permanece abierto para claridad de los mensajes originales de liberacion/inicio; esta respuesta breve de reintento fue comprensible. No se implementaron correcciones.
- Limites: no prueba concurrencia, reintento desde otro rol, estados cerrados ni entrega tardia fuera de la ventana observada. No se revalido dashboard; evidencia de no duplicacion por WhatsApp y SQL. Sin Siigo, cambios de codigo, commit ni push.
- Revision de Juan: autorizo continuar con la siguiente prueba; sin correcciones aprobadas.

### MAN-017 - Merma de proceso con nombre cotidiano y referencia automatica

- Fecha: 2026-09-04, 12:20-12:21 de Bogota. Sin archivos. Roles activos verificados por SQL: Juan admin, Jobana alistador y Datana recepcion_cierre; sin cambios.
- Precondicion: OP69 EN_PROCESO/F1, sin mermas previas; materiales ya consumidos en MAN-015. Stock de las ocho asignaciones conserva cantidades0,0,5,0,239,239,11,920 y reservas0; Kardex de insumos73 movimientos antes del registro.
- Mensaje desde Datana: `En la orden 69 se perdieron 10 gramos de goma por derrame durante produccion.` En WhatsApp con tilde normal. No se dicto SKU, lote, ubicacion, OP larga ni referencia de merma.
- Resultado: CORRECTO con observacion de unidades. Identifica goma como producto60 / 00051-MPASH por contexto de la OP. Respuesta completa sin JSON ni Read more: Merma MER-9CC4C586 registrada, referencia generada AUTO-MER-20260904-960AE75A, cantidad10, motivo derrame, OP-20260904-000069 y registro para conciliacion.
- SQL: mermas ID20, tipo PROCESO, producto_id60, orden_produccion_id69, cantidad10, motivo derrame, usuario_id18, estado APROBADO. Lote y ubicacion NULL: registro a nivel de material/orden, sin afirmar una atribucion de merma a un lote fisico especifico.
- Inventario: las ocho cantidades y reservas permanecen identicas. Lote BEMO-GOMAS-E2E-001 conserva920 DISPONIBLE. Siguen ocho consumos originales de la OP, que permanece EN_PROCESO/F1. No hubo segundo descuento de los10 g desde stock.
- Auditoria: un nuevo Kardex MERMA_PROCESO, qty=-10, lot_id=NULL, balance_after=NULL, producto60, user18, referencia merma:MER-9CC4C586, nota derrame | Orden: OP-20260904-000069. No confundir ese registro de perdida en proceso con una nueva salida de bodega. Logs1178 RECEIVED y1179 PROCESSED, REPORTE_MERMA.
- Dashboard > Mermas > Historial: fila AUTO-MER-20260904-960AE75A, PROCESO, SKU/nombre correcto, cantidad10.000, OP69, ubicacion -, motivo derrame y fecha2026-09-04. No presenta error de carga.
- Pendientes relacionados: P-017 ampliado por la misma omision de unidades en mensajes de produccion: respuesta dice Cantidad:10 sin g; dashboard tambien omite unidad en la columna cantidad. Incluir ambos en la revision coherente de nombres/unidades sin abrir trabajos duplicados. P-011 no se resuelve para devoluciones: aqui solo se confirma que merma por WhatsApp ya genera referencia automaticamente.
- Limites: no prueba reintento de merma sin referencia, exceso sobre material entregado, conversion kg/g, ambiguedad de varias gomas, ni conciliacion final al cierre. No se verifica entrega de notificaciones adicionales ni autorizacion de otro rol. Sin codigo, Siigo, commit ni push.
- Revision de Juan: autorizo continuar con la siguiente prueba; sin correcciones aprobadas.

### MAN-018 - Reenvio de merma sin referencia fuera de ventana temporal

- Fecha: 2026-09-04, 12:25 de Bogota. Sin archivos ni cambios de roles. Verificados Juan admin, Jobana alistador y Datana recepcion_cierre activos.
- Precondicion: OP69 EN_PROCESO/F1 con una merma de10 g, ID20 MER-9CC4C586, creada17:21:07Z. Lectura previa reporta233 segundos de antiguedad. El codigo local waste-workflow.js, findRecentGenerated, compara actor/producto/orden/lote/ubicacion/cantidad/motivo solo dentro de2 minutos. Se informo a Juan de esta limitacion antes del unico reenvio; no se alteraron timestamps ni referencias.
- Accion: Datana reenvia exactamente `En la orden 69 se perdieron 10 gramos de goma por derrame durante produccion.` (con tilde en WhatsApp), sin referencia. Intencion del ejecutor: repetir el mismo incidente, no declarar otra perdida. Son dos mensajes de WhatsApp distintos, no un replay del mismo identificador de transporte.
- Resultado: FALLA para recuperar el mismo incidente mediante reenvio tardio sin referencia. Respuesta completa registra MER-F4C3ECDB con nueva referencia AUTO-MER-20260904-C36B202C; no pregunta si es otra perdida ni advierte del reporte anterior. Sin JSON ni Read more.
- SQL: inserta merma ID21 PROCESO, producto60, OP69,10 g, motivo derrame, usuario18, creada17:25:43Z. Se conserva ID20; suma aprobada de la OP10->20 g. Separacion entre registros276 segundos (4min36s). Logs1180 RECEIVED y1181 PROCESSED, REPORTE_MERMA.
- Inventario: stock IDs124,125,126,127,130,131,142,146 conserva0,0,5,0,239,239,11,920 y reservas0. No hubo segundo descuento de bodega. Hay un Kardex MERMA_PROCESO por cada merma, ambos qty=-10, lot_id=NULL y balance_after=NULL.
- Dashboard: al inspeccionar, la pestana estaba en Kardex; se ven las dos entradas de merma, incluida merma:MER-F4C3ECDB a17:25. No se afirma haber revalidado Historial de mermas en esta prueba. Hora UTC vuelve a relacionarse con P-003. La fila nueva muestra SALDO7841.25 pese a balance_after=NULL en DB: relacionar con revision de semantica P-010; origen de ese valor pendiente de diagnostico, no evidencia de descuento adicional.
- Pendiente nuevo P-018, relacionado con P-011/P-015: diferenciar un reintento del mismo incidente de una perdida nueva coincidente. El sistema no puede deducir siempre esa intencion de un texto identico; considerar referencia operativa conservada en conversacion, idempotencia por evento y aclaracion explicita ante coincidencias. No deduplicar indefinidamente por texto ni limitarse a alargar2 minutos, porque podria ocultar perdidas reales.
- Estado de evidencia: no se borran ni corrigen registros. OP69 acumula20 g contables de merma,10 g del reporte inicial y10 g del reenvio de QA. Advertencia para conciliacion/cierre posterior: no presentar20 g como dos incidentes fisicos reales validados. Resolver tratamiento del duplicado antes de dar por validado el cierre.
- Limites: no valida deduplicacion dentro de2 minutos, replay del mismo evento de transporte, reintento con referencia explicita ni concurrencia. No se ejecutan correcciones, Siigo, commit o push.
- Revision de Juan: autoriza expresamente continuar con la misma OP para comprobar que el cierre contemple las mermas previas, conservando el duplicado de QA como evidencia.

### MAN-019 - Cierre de OP con mermas previas y conciliacion

- Fecha: 2026-09-04, 12:31 de Bogota. Sin archivos ni cambios de roles: Juan admin, Jobana alistador, Datana recepcion_cierre, activos verificados. Juan autoriza cerrar la misma OP con la evidencia duplicada de MAN-018; no se limpia previamente.
- Precondicion SQL: OP69 EN_PROCESO/F1, plan3, sin reposiciones; materiales consumidos3 de cada empaque y540 g de gomas, sin adicionales/devoluciones. Mermas previas ID20/21,10 g cada una, ambas aprobadas para producto60. C2 ID66 y bodega1 activas. No existe lote PT de OP69; stock bruto del PT74=158.5, reservas0 (no interpretar ese total bruto como disponibilidad elegible).
- Mensaje unico desde Datana: `Cerramos la orden 69 con 2 tarros conformes y 1 merma por dano de empaque. Dejar el producto terminado en C2.` En WhatsApp con caracteres espanoles normales. No se repiten los20 g ni se dicta lote/vencimiento.
- Resultado: CORRECTO para incorporar las mermas ya registradas al cierre; no resuelve P-018 ni certifica un balance fisico completo. OP69 CERRADA/F5, cantidad_real2, aprobado_por18, cerrado_en=2026-09-04T17:31:31Z.
- WhatsApp Datana: cierre confirmado, conformes2, merma1, lote LPN-OP-20260904-000069, vence2026-09-15, ubicacionC2. Mensaje completo sin corte. Juan recibe notificacion de cierre; se expande Read more y se lee hasta el ultimo material. Informa plan3, conformes2, merma1(33.33%), motivo dano de empaque, Datana12:31 y conciliacion.
- Conciliacion verificada en mensaje y respuesta API: gomas teorico540, neto entregado540, merma_proceso20, uso_productivo_estimado520 y variacion0. Empaques: teorico3, neto3, merma_proceso0, estimado3, variacion0 por componente. Los20 g se obtienen de registros previos, sin pedirlos otra vez ni sumarlos a la merma de PT en unidades.
- SQL producto terminado: stock nuevo ID152, producto74, lote LPN-OP-20260904-000069, C2/ubicacion66, cantidad2, reservada0. Lots qty_initial=qty_current=2, DISPONIBLE, production_order_id69, vence2026-09-15 heredado de BEMO-GOMAS-E2E-001. Stock bruto del PT158.5->160.5, filas16->17.
- SQL mermas: conserva IDs20/21 de10 g e inserta ID22 MER-1788543087574 por1 unidad de producto74, motivo dano de empaque, PROCESO/APROBADO. No sumar gramos y unidades como una cantidad homogenea.
- Sin doble consumo: stock de insumos IDs124,125,126,127,130,131,142,146 conserva0,0,5,0,239,239,11,920 y reservas0. Kardex de referencia produccion:OP-20260904-000069 mantiene ocho CONSUMO_MATERIAL y agrega solo un CIERRE_PRODUCCION +2, saldo2, user18. No se reingresa ni descuenta otra vez el material perdido.
- Evidencia: logs1182 RECEIVED y1183 PROCESSED, CERRAR_ORDEN_PRODUCCION; context.production_close.material_reconciliation incluye20/520 para gomas, qty_real2, qty_waste1 y origen del vencimiento. Dashboard Listado muestra OP69 Cerrada/F5, plan3, real2 y nuevo lote PT.
- Pendientes relacionados: P-018 ahora tiene impacto confirmado aguas abajo: la conciliacion incorpora tambien los10 g del duplicado de QA sin detectarlo. No se da por saneada la orden. P-017 sigue aplicable al cierre: conciliacion por SKU, sin unidades explicitas ni nombres cortos de materiales. P-003 persiste en la hora de creacion16:56 del listado; no es la hora de cierre.
- Limite de interpretacion:520 g es neto entregado menos merma de proceso registrada, no una medicion de gomas en los dos tarros conformes ni prueba de balance fisico cerrado. No se asigna automaticamente material entre PT conforme, PT danado y posibles sobrantes. No se inventan160 g adicionales de merma por comparar520 con2x180; se conserva para discutir la logica de conciliacion con el cliente.
- Limites de prueba: no incluye reintento de cierre, cierre con0 merma, merma previa del mismo SKU terminado, concurrencia ni exportacion Siigo. La capacidad de reconocer un duplicado sigue pendiente. Sin correcciones de datos/codigo, commit o push.
- Revision de Juan: autoriza otra prueba para validar reposicion de materiales y cumplimiento de la meta. OP69 queda cerrada como evidencia, sin reabrirla.

### MAN-020 - Reposicion de BOM para completar la meta de produccion

- Fecha: 2026-09-04, inicio12:36 de Bogota. Sin archivos ni cambios de roles. Juan admin autoriza, Jobana alistador entrega y Datana recepcion_cierre cierra. Nueva OP70; OP69 no se altera.
- Escenario: plan3 tarros de ashwagandha60, perdida de una unidad completa sin recuperar materiales, reposicion de BOM para1 unidad, resultado previsto3 conformes y1 merma PT. La perdida se documenta inicialmente como motivo de reposicion; no se registra ademas una merma PT previa para evitar contar dos veces el mismo incidente al cerrar.
- Stock inicial elegible seleccionado: tapas ID142=11, tarros ID130=239, etiquetas ID126=5, liners ID131=239, gomas ID146=920 g; reservas0. Material para4 unidades suficiente.
- Preparacion del escenario: Juan envia `Vamos a producir 3 tarros de ashwagandha 60 para stock de seguridad.` Se crea OP70 OP-20260904-000070 plan3 y se avisa a Jobana. Jobana envia `Ya aliste los materiales de la orden ID 70` (con tilde). OP EN_PROCESO/F1, cinco consumos iniciales:3 de cada empaque y540 g. Saldos respectivos8,236,2,236,380, reservas0. Admin y Datana reciben aviso de inicio.
- Autorizacion de Juan: `En la orden 70 se perdio un tarro completo por contaminacion y no se recupero ningun material. Autorizo reponer todos los materiales del BOM completo para fabricar 1 unidad faltante y completar las 3 unidades de la orden.` En WhatsApp con acentos. Confirma explicitamente BOM completo; no se prueba aqui la pregunta aclaratoria cuando falta esa confirmacion.
- Reposicion creada: ID1 REP-OP-000070-0001, cantidad_objetivo1, motivo contaminacion, solicitada_por5, PENDIENTE_ALISTAMIENTO. Reserva1 tarro A11,1 tapa A8,1 etiqueta PPAL-A-1-01,1 liner A14 y180 g de gomas B16, mismos lotes elegidos al iniciar. Saldos fisicos conservados8,236,2,236,380; reservas1,1,1,1,180. Cero Kardex de reposicion antes de confirmar. Aviso completo recibido por Jobana y respuesta al admin verificados.
- Bloqueo: Datana intenta `Cerramos la orden 70 con 2 tarros conformes y 1 merma por contaminacion. Dejar el producto terminado en C2.` Responde reposicion pendiente, confirmar o cancelar antes de cerrar. SQL conserva EN_PROCESO/F1, cantidad_real0, sin lote PT ni mermas de la OP. No se cancela reposicion.
- Confirmacion de entrega: Jobana envia `Ya aliste la reposicion de la orden 70.` (acentos normales), sin codigo REP largo ni dictar materiales. Reposicion1 queda CONFIRMADA, confirmada_por20. Descuenta1 de cada empaque y180 g; stock final tapas7, tarros235, etiquetas1, liners235, gomas200. Reservas0. Lots coincide con stock. Cinco Kardex CONSUMO_MATERIAL con referencia reposicion:REP-OP-000070-0001, cantidades individuales correctas y actor20.
- Material adicional: produccion_materiales conserva teorico3 para cada empaque y540 g de gomas; cantidad_consumida pasa a4 y720 respectivamente, cantidad_adicional1 y180, devuelta0. La meta de la OP permanece3, no aumenta a4. La OP sigue EN_PROCESO hasta el cierre.
- Avisos: Jobana recibe confirmacion detallada; Juan y Datana reciben Reposicion de materiales confirmada, objetivo1, confirmanteJobana, cinco asignaciones y EN_PROCESO. Mensajes reales completos leidos. Preparacion solo aviso al alistador; confirmacion aviso admin/recepcion_cierre observado.
- Cierre: Datana envia `Cerramos la orden 70 con 3 tarros conformes y 1 merma por contaminacion. Dejar el producto terminado en C2.` OP70 CERRADA/F5, plan3, real3, aprobado_por18. Stock153 y lote LPN-OP-20260904-000070 con3 unidades, C2/ubicacion66, reservas0, vence2026-09-15. Una merma PT ID23 MER-1788543650610, cantidad1, motivo contaminacion. Insumos permanecen en los saldos posteriores a reposicion; no hay nuevo consumo al cerrar.
- Conciliacion de cierre: aviso a Juan expandido mediante Read more hasta el ultimo componente. Empaques teorico3, entregado4, variacion1; gomas teorico540, entregado720, variacion180. Merma_proceso0 en los componentes porque se declaro la perdida como unidad PT al cierre, no como perdidas individuales de MP. Uso productivo estimado4/720 no significa cuatro unidades conformes; no prueba balance fisico detallado de material contenido en la unidad perdida.
- Dashboard tras recarga: OP70 plan3, real3, lote LPN-OP-20260904-000070, F5/Cerrada. Hora de creacion17:36 frente a12:36 en WhatsApp, nueva evidencia de P-003. No se ejecuto el flujo mediante formularios del dashboard; solo se cotejo el resultado.
- Evidencia: logs1184/1185 liberacion,1186/1187 inicio,1188/1189 preparacion,1190/1191 cierre bloqueado (REJECTED),1192/1193 confirmacion reposicion,1194/1195 cierre correcto. Kardex5 consumos iniciales,5 adicionales y1 ingreso PT+3. No sumar en un mismo total gramos y unidades de esos movimientos.
- Pendientes relacionados observados: P-017, nombres/unidades e instrucciones por rol. Aviso alistador pide codigo REP largo aunque el prompt permite ID de orden. Bloqueo a Datana dice confirmala o cancelala, acciones operativamente asignadas a alistador/admin. No se cambian permisos ni mensajes.
- Hallazgo nuevo P-019: cierre informa Merma1 (33.33%), calculado contra plan3; respecto a resultado3 conformes+1 merma seria25%. Aclarar denominador/objetivo del indicador, no declarar corrupto el registro ni cambiarlo sin acuerdo. P-017 sigue aplicable a nombres/unidades y mensajes por responsabilidad.
- Resultado: CORRECTO para reposicion de BOM completo autorizada, reserva sin consumo, bloqueo de cierre pendiente, entrega adicional y cumplimiento de meta; con observaciones de comunicacion/indicadores. No valida recuperacion parcial de componentes, falta de autorizacion explicita, cancelacion, reintento de reposicion, concurrencia ni reporte previo de merma del mismo PT ademas de la merma final. Esos escenarios no se dan por aprobados.
- Revision de Juan: autoriza siguiente prueba; pendientes P-017/P-019 abiertos, sin correcciones aprobadas.

### MAN-021 - Reintento de reposicion confirmada despues del cierre

- Fecha: 2026-09-04, 12:52 de Bogota. Sin archivos ni cambios de roles. SQL confirma Juan admin, Jobana alistador, Datana recepcion_cierre, activos. Primera consulta de roles fallo con ECONNRESET y se recupero al reintentar lectura antes del envio.
- Precondicion: OP70 CERRADA/F5, cantidad_real3, cerrado_en17:40:54Z; reposicion1 REP-OP-000070-0001 CONFIRMADA por20 a17:39:25Z. Stock IDs126,130,131,142,146,153 con cantidades1,235,235,7,200,3 y reservas0. Cinco consumos iniciales, cinco consumos de reposicion y un ingreso PT.
- Accion: Jobana repite `Ya aliste la reposicion de la orden 70.` (acentos normales en WhatsApp), mismo texto que MAN-020. Se usa ID corto de OP, no codigo REP; una repeticion secuencial posterior al cierre.
- Resultado: CORRECTO. Respuesta completa: `La reposicion REP-OP-000070-0001 ya estaba confirmada. No se modifico inventario.` Sin JSON ni Read more en esta respuesta.
- SQL antes/despues: seis cantidades y reservas identicas, OP conserva CERRADA/F5, real3 y fecha de cierre; reposicion conserva confirmante/fecha originales. Siguen cinco consumos iniciales, cinco adicionales y un unico CIERRE_PRODUCCION; no se reabre la OP ni se crea otra reposicion.
- Evidencia: logs1196 RECEIVED y1197 PROCESSED, CONFIRMAR_REPOSICION_PRODUCCION; context.production_replenishment.already_confirmed=true, consumed=[]. Lectura complementaria de codigo local confirma retorno temprano de reposicion CONFIRMADA antes de modificar inventario; no se usa eso como prueba de version desplegada.
- WhatsApp destinatarios: antes/despues de procesarse el reintento, ultimo mensaje del admin sigue siendo conciliacion de cierre12:40 y Datana conserva cierre12:40. No se observaron nuevos avisos en esa ventana. Se expandio Read more del cierre previo del admin para mantener lectura completa, sin confundirlo con respuesta nueva.
- Pendientes: sin hallazgo nuevo. P-017/P-019 de la prueba anterior siguen abiertos; este reintento no los corrige ni revalida. No se inspecciono dashboard de nuevo: no duplicacion cotejada por SQL y WhatsApp.
- Limites: no prueba concurrencia, varias reposiciones en una misma OP, reposicion cancelada, nueva solicitud de reposicion sobre OP cerrada ni avisos tardios fuera de la ventana observada. Sin Siigo, cambios de datos directos/codigo, commit o push.
- Revision de Juan: autoriza siguiente prueba. OP70 permanece cerrada y reposicion1 confirmada; roles sin cambios.

### MAN-022 - Cancelacion de reposicion ya confirmada y consumida

- Fecha: 2026-09-04, 13:04 de Bogota. Sin archivos ni cambios de roles. Juan conserva rol admin; Jobana, alistador; Datana, recepcion_cierre.
- Precondicion: OP70 `OP-20260904-000070` CERRADA/F5, plan 3 y real 3. Reposicion 1 `REP-OP-000070-0001` CONFIRMADA por Jobana. Stock IDs 126, 130, 131, 142, 146 y 153 en cantidades 1, 235, 235, 7, 200 y 3, con reservas en cero.
- Accion: desde la linea administradora se envia `Cancela la reposicion de la orden 70.` usando el ID corto de la OP, sin exigir el codigo largo de reposicion.
- Resultado: CORRECTO. Respuesta completa: `Una reposicion confirmada no se puede cancelar`. No hubo JSON, texto truncado ni solicitud de datos adicionales.
- SQL antes/despues: OP70 conserva CERRADA/F5, cantidad real 3 y fecha de cierre; reposicion 1 conserva estado CONFIRMADA, confirmante y fecha originales, con `cancelada_por` y `cancelada_en` nulos. Los seis saldos, reservas y marcas de actualizacion permanecen identicos.
- Evidencia: logs 1198 RECEIVED y 1199 REJECTED para `CANCELAR_REPOSICION_PRODUCCION`; el segundo registra HTTP 409 y el mismo mensaje mostrado por WhatsApp. El payload preservo el mensaje real y resolvio `id_orden: 70`.
- WhatsApp destinatarios: Jobana conserva como ultimo mensaje el reintento de confirmacion de MAN-021 a las 12:52; Datana conserva el cierre de OP70 a las 12:40. No se generaron avisos por la cancelacion rechazada.
- Pendientes: sin hallazgo nuevo. La proteccion evita devolver al stock materiales ya consumidos o alterar una orden cerrada. P-017 y P-019 siguen abiertos sin revalidacion.
- Limites: no prueba cancelacion valida de una reposicion pendiente, concurrencia entre confirmar/cancelar ni multiples reposiciones para una misma OP. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: OP70 cerrada; reposicion 1 confirmada; roles sin cambios.

### MAN-023 - Cancelacion valida de reposicion pendiente y liberacion de reservas

- Fecha: 2026-09-04, 13:13-13:15 de Bogota. Sin archivos ni cambios de roles: Juan admin, Jobana alistador y Datana recepcion_cierre. Una consulta inicial de capacidad fallo con ECONNRESET; el reintento funciono antes de crear la OP.
- Preparacion: Juan libera OP71 `OP-20260904-000071` para 1 tarro de Ashwagandha 60 de stock de seguridad. Jobana confirma materiales; se consumen 1 tarro, 1 tapa, 1 etiqueta, 1 liner y 180 g de gomas. OP queda EN_PROCESO/F1 y los avisos de inicio se procesan.
- Reposicion: Juan declara perdida completa por contaminacion y autoriza BOM para 1 unidad. Se crea ID 2 `REP-OP-000071-0002`, PENDIENTE_ALISTAMIENTO. Reserva 1 tarro, 1 tapa, 1 etiqueta, 1 liner y 180 g de gomas; estas ultimas se dividen FEFO en 20 g de `BEMO-GOMAS-E2E-001` y 160 g de `DEMO-GOMAS-001`. Jobana recibe la instruccion completa de alistamiento.
- Accion evaluada: antes de que Jobana confirme, Juan envia `Cancela la reposicion de la orden 71.` usando ID corto de OP. Respuesta completa: `Reposicion REP-OP-000071-0002 cancelada para OP-20260904-000071. Se liberaron las reservas y no se desconto inventario.` Sin JSON ni truncamiento.
- Resultado funcional: CORRECTO. Reposicion queda CANCELADA por usuario 5, sin confirmante; OP71 sigue EN_PROCESO/F1. Las reservas de stock 1,1,1,1,20 y160 vuelven a cero. Las cantidades fisicas permanecen 234,6,10,234,20 y1744.25. Los acumulados de material regresan a la reserva/consumo inicial: 1 unidad por empaque y180 g de gomas; adicional permanece cero.
- Integridad: no existe Kardex cuya referencia contenga `REP-OP-000071-0002`; las seis asignaciones historicas de la reposicion conservan sus cantidades reservadas, pero el padre CANCELADA, las reservas reales de stock en cero y el acumulado material corregido distinguen historial de reserva activa.
- Evidencia: logs 1200-1207 cubren liberacion, inicio, preparacion y cancelacion. Cancelacion 1206 RECEIVED/1207 PROCESSED informa `released_allocations: 6`. SQL antes/despues coteja reposicion, OP, materiales, seis asignaciones y seis filas de stock.
- Resultado de comunicacion: PARCIAL. Jobana recibio la autorizacion para alistar, pero despues de cancelar su ultimo mensaje sigue ordenandole confirmar `REP-OP-000071-0002`; no recibio aviso de cancelacion. Registrar P-020 para evitar una instruccion operativa obsoleta. No se envio una confirmacion posterior desde Jobana en esta prueba.
- Limites: no prueba intento de confirmar una reposicion CANCELADA, reintento de cancelacion, concurrencia confirmar/cancelar, cancelacion desde rol incorrecto ni cierre posterior de OP71. No se inspecciono dashboard; estado e inventario se cotejaron por WhatsApp/SQL. OP71 queda deliberadamente EN_PROCESO para una prueba posterior. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: OP71 EN_PROCESO; reposicion 2 CANCELADA; reservas de reposicion en cero; roles sin cambios.

### MAN-024 - Intento de confirmar una reposicion cancelada

- Fecha: 2026-09-04, 13:21 de Bogota. Sin archivos ni cambios de roles: Juan admin, Jobana alistador y Datana recepcion_cierre.
- Precondicion: OP71 EN_PROCESO/F1, cantidad real 0; reposicion 2 `REP-OP-000071-0002` CANCELADA por Juan, sin confirmante. Sus seis filas de stock conservan cantidades 234, 6, 10, 234, 20 y 1744.25, reservas en cero y cero Kardex asociado a la reposicion.
- Accion: Jobana envia `Ya aliste la reposicion de la orden 71.` usando el ID corto que puede inferirse de la instruccion obsoleta observada en MAN-023.
- Resultado: CORRECTO. WhatsApp responde `La reposicion esta CANCELADA`; mensaje completo, sin JSON, truncamiento ni solicitud de otro identificador.
- Integridad antes/despues: reposicion permanece CANCELADA, `confirmada_por`/`confirmada_en` nulos y cancelacion original intacta. OP71 sigue EN_PROCESO/F1. Cantidades, reservas y `actualizado_en` de las seis filas de stock permanecen identicos; asignaciones adicionales conservan consumo cero y sin confirmante; no existe Kardex de la reposicion.
- Evidencia: logs 1208 RECEIVED y 1209 REJECTED para `CONFIRMAR_REPOSICION_PRODUCCION`, telefono de Jobana, HTTP 409 y el mismo mensaje mostrado por WhatsApp.
- Notificaciones: el administrador conserva como ultimo aviso la cancelacion de las 13:15; Datana conserva el inicio de OP71 de las 13:14. El intento rechazado no genero avisos falsos.
- Pendientes: sin hallazgo nuevo. Amplia P-020: una instruccion obsoleta puede inducir el intento, pero la API falla cerrado y protege inventario. La correccion pendiente sigue siendo avisar la cancelacion al alistador, no debilitar este bloqueo.
- Limites: no prueba simultaneidad confirmar/cancelar, reintento de cancelacion ni cierre de OP71. No se inspecciono dashboard; evidencia por WhatsApp y SQL. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: OP71 EN_PROCESO; reposicion 2 CANCELADA; inventario sin cambios; roles sin cambios.

### MAN-025 - Reintento de cancelacion de reposicion

- Fecha: 2026-09-04, 13:26 de Bogota. Sin archivos ni cambios de roles: Juan admin, Jobana alistador y Datana recepcion_cierre.
- Precondicion: OP71 EN_PROCESO/F1; reposicion 2 `REP-OP-000071-0002` CANCELADA por Juan a las 18:15:44Z, sin confirmante. Seis stocks relacionados con cantidades 234, 6, 10, 234, 20 y 1744.25, reservas cero; cero Kardex de reposicion.
- Accion: Juan repite exactamente `Cancela la reposicion de la orden 71.` usando ID corto de OP.
- Resultado: CORRECTO. Respuesta completa: `La reposicion REP-OP-000071-0002 ya estaba cancelada. No se modifico inventario.` Sin JSON ni truncamiento.
- Integridad antes/despues: OP71 conserva EN_PROCESO/F1 y real 0. Reposicion conserva CANCELADA, cancelador y fecha originales; no adquiere confirmante. Cantidades, reservas y `actualizado_en` de los seis stocks permanecen identicos.
- Evidencia: logs 1210 RECEIVED y 1211 PROCESSED, `CANCELAR_REPOSICION_PRODUCCION`; contexto `already_cancelled: true` y sin bloque de notificacion.
- Notificaciones: no se genero un nuevo aviso al alistador ni a recepcion/cierre. Esto no resuelve P-020: Jobana continua sin aviso de la cancelacion original.
- Pendientes: sin hallazgo nuevo. La idempotencia secuencial de cancelacion queda validada; P-020 permanece abierto.
- Limites: no prueba simultaneidad, cancelacion desde rol incorrecto ni cierre posterior de OP71. No se inspecciono dashboard; evidencia WhatsApp/SQL. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: OP71 EN_PROCESO; reposicion 2 CANCELADA; inventario sin cambios; roles sin cambios.

### MAN-026 - Cierre sin producto conforme despues de cancelar reposicion

- Fecha: 2026-09-04, 13:31 de Bogota. Sin archivos ni cambios de roles: Juan admin, Jobana alistador y Datana recepcion_cierre.
- Precondicion: OP71 EN_PROCESO/F1, plan 1 y real 0; materiales iniciales consumidos una sola vez. Reposicion 2 CANCELADA, reservas en cero, sin confirmante ni Kardex adicional. No existian lote PT ni merma asociados a OP71.
- Accion: Datana envia `Cerramos la orden 71 con 0 tarros conformes y 1 merma por contaminacion.` No incluye ubicacion porque no existe producto conforme que almacenar.
- Resultado funcional: CORRECTO. OP71 pasa a CERRADA/F5, cantidad real 0 y cierre por usuario 18. Se registra una merma aprobada de 1 unidad del PT, motivo contaminacion. La reposicion permanece CANCELADA y no se consume.
- Inventario: no se crea `LPN-OP-20260904-000071`, fila de stock, movimiento de entrada ni Kardex `CIERRE_PRODUCCION`. Permanecen solo los cinco `CONSUMO_MATERIAL` iniciales; las reservas siguen en cero. Esto concuerda con cero producto conforme.
- Respuesta a Datana: PARCIAL por presentacion. Muestra `Orden ... cerrada`, conformes 0 y merma 1, pero tambien `Lote PT: null` y `Ubicacion: null`; vencimiento indica `No aplica`. Registrar P-021. No hubo JSON ni Read more.
- Aviso al administrador: CORRECTO. Se recibio `Lote PT: Sin lote conforme | ubicacion N/A | vence N/A`, merma 100%, actor y conciliacion completa. Se hizo clic en Read more y se leyeron los cinco componentes. El aviso no reproduce los `null`.
- Evidencia: logs 1212 RECEIVED y 1213 PROCESSED, `CERRAR_ORDEN_PRODUCCION`; contexto confirma `qty_real: 0`, `qty_waste: 1`, `lpn_terminado: null`, sin ubicacion/vencimiento y notificacion enviada al admin. SQL confirma una merma ID24, cero lotes/stock PT y reposicion cancelada intacta.
- Pendientes: P-021 nuevo, limitado a la plantilla de respuesta directa del cierre sin conformes. P-019 no se reevalua: 100% coincide bajo los dos denominadores en este caso. P-020 permanece abierto.
- Limites: no prueba reintento de este cierre, dashboard de produccion ni cierre con0 conformes/varias mermas de proceso previas. El intento de abrir el dashboard por automatizacion expiro y reinicio la sesion CUA; no se usa como evidencia de fallo del WMS. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: OP71 CERRADA con0 conformes y1 merma; reposicion 2 CANCELADA; sin stock PT; roles sin cambios.

### MAN-027 - Reintento de cierre sin producto conforme

- Fecha: 2026-09-04, 13:39 de Bogota. Sin archivos ni cambios de roles: Juan admin, Jobana alistador y Datana recepcion_cierre.
- Precondicion: OP71 ya CERRADA/F5 desde las 13:31, cantidad real 0, una unica merma ID24 por 1 unidad y sin lote ni stock de PT. El Kardex contiene solo los cinco consumos iniciales de materiales.
- Accion: Datana repite exactamente `Cerramos la orden 71 con 0 tarros conformes y 1 merma por contaminacion.`
- Resultado: CORRECTO. WhatsApp responde `La orden OP-20260904-000071 ya estaba cerrada por Datana el 4/09/26, 1:31 p. m.. No se modifico inventario.` Sin JSON, truncamiento ni datos nulos visibles.
- Integridad antes/despues: OP71 conserva CERRADA/F5, cantidad real 0, fecha y aprobador originales. Permanece una sola merma, ID24, con cantidad total 1. No se crearon lote `LPN-OP-20260904-000071`, fila de stock ni movimiento `CIERRE_PRODUCCION`; el Kardex conserva cinco `CONSUMO_MATERIAL` por -184 unidades agregadas.
- Evidencia: logs 1214 RECEIVED y 1215 PROCESSED para `CERRAR_ORDEN_PRODUCCION`, telefono de Datana y el mismo mensaje idempotente mostrado en WhatsApp. El contexto no expone una bandera `already_closed`, por lo que la conclusion se apoya en mensaje, SQL y ausencia de efectos.
- Notificaciones: el administrador conserva como ultimo aviso el cierre original de las 13:31. El reintento no genero un segundo aviso.
- Pendientes: sin hallazgo nuevo. P-021 no se reproduce en la respuesta de reintento; permanece limitado a la plantilla del primer cierre con cero conformes.
- Limites: valida idempotencia secuencial, no dos cierres concurrentes. No se inspecciono dashboard. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: reintento idempotente, sin nueva merma, lote, stock, Kardex ni notificacion.

### MAN-028 - Lectura de PDF de salida de materiales hacia 3Q

- Fecha: 2026-09-04, 13:47 de Bogota. Sin cambios de roles: Juan admin, Jobana alistador y Datana recepcion_cierre. Archivo usado: `output/pdf/demo-presentacion/DEMO-PRESENTACION-SALIDA-3Q.pdf`.
- Accion: Juan envia el PDF al agente con `Registra esta salida de materiales hacia 3Q como borrador.` La evidencia visible de WhatsApp muestra archivo y texto en una misma burbuja; por tanto, esta ejecucion no prueba aun archivo y orden enviados en mensajes separados.
- Resultado funcional: CORRECTO CON OBSERVACIONES. El agente registra el documento ID6, referencia `DEMO-PRESENTACION-SALIDA-3Q`, origen BUILDERBOT, cuatro SKU por 4 unidades cada uno y total16. Responde que es un borrador y que no modifico inventario. No muestra JSON ni requiere Read more.
- Dashboard: `Maquila 3Q > Documentos leidos` muestra el borrador, destinatario 3Q, actor Juan, cuatro items correctamente cruzados al catalogo y `Sin vincular`. No se creo remision operativa.
- Integridad: SQL confirma `maquila_envio_id` y `orden_compra_id` nulos, cero Kardex con la referencia y ningun Kardex nuevo desde el procesamiento. Logs1216/1217 registran RECEIVED/PROCESSED para `REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO` y `inventory_changed=false` en el contrato observado por respuesta.
- Observacion documental: el estado queda REQUIERE_CORRECCION por la marca de demostracion y porque los cuatro items no contienen lote ni vencimiento. La remision operativa posterior es la que selecciona lotes FEFO; queda por decidir si esos campos deben exigirse tambien en el PDF previo o tratarse como informacion que completa el picking (P-023).
- Evidencia PDF: la fila documental y sus items se guardan, pero `documento_bodega_borrador_archivos` no contiene el PDF y el dashboard no ofrece descarga. Los cuatro borradores de OC observados si tienen archivo; los dos borradores de salida 3Q no. El handler local de salida 3Q consume texto documental pero no pasa `document_url` al servicio (P-022).
- Variante pendiente: validar el caso operativo indicado por Juan en el que primero llega el PDF sin instruccion y luego un mensaje separado. Debe asociarlos una sola vez o pedir aclaracion sin inventar datos ni duplicar (P-024).
- Limites: no se repitio el mismo PDF, no se creo/vinculo remision y no se confirmo salida. No se probaron imagen fotografica, PDF sin texto, mensajes separados ni concurrencia. Sin Siigo, cambios de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. El borrador queda registrado sin movimiento; P-022, P-023 y P-024 permanecen abiertos.

### MAN-029 - Preparacion de remision 3Q sin OC vinculada

- Fecha: 2026-09-04, 13:56 de Bogota. Sin archivo nuevo ni cambios de roles. Accion ejecutada en dashboard con la cuenta Admin WMS (`admin`); Juan, Jobana y Datana conservan sus roles de WhatsApp.
- Precondicion: producto PT `00105-PTBOS60`, maquilador `3Q - PROVEEDOR DEMO`, objetivo4. BOM ENVIO: una tapa `00001-TPBI`, un tarro `00006-TRP`, una etiqueta `00018-ETBOS60` y un liner `00035-LNTP60` por unidad. Los stocks elegibles tenian reserva cero.
- Accion: en `Maquila 3Q > Nueva remision` se deja la OC como `Pendiente de cargar o vincular`, se elige3Q, producto `00105-PTBOS60`, cantidad4 y nota `MAN-029 preparacion sin OC vinculada`; se pulsa `Preparar remision y picking`.
- Resultado: CORRECTO. Se crean orden ID5 `MQ-3Q-20260904-000005` en `MATERIALES_RESERVADOS` y remision ID3 `REM-3Q-20260904-000003` en BORRADOR, ambas sin OC. Objetivo4 y recibido0.
- Picking y FEFO/FIFO: reserva4 unidades de cada material: tapa lote `RECINT-64-90-01` en A8; tarro `DEMO-MAPA-A11-00006-TRP` en A11; etiqueta Booster `RECINT-64-95-01` en A1; liner `DEMO-MAPA-A14-00035-LNTP60` en A14. Para existencias sin vencimiento, selecciona las filas mas antiguas observadas antes que las alternativas posteriores.
- Integridad: las cantidades fisicas permanecen6,234,6 y234 en las filas seleccionadas; `stock.reservada` cambia de0 a4. Cada material conserva `cantidad_enviada=0`; no hay confirmante, fecha de salida ni Kardex de esta orden/remision.
- Dashboard: muestra `Remisiones pendientes de salida`, codigo, destino externo3Q, cuatro SKU con cantidad, lote y ubicacion, y acciones separadas para confirmar o cancelar. En seguimiento aparece `Pendiente de vincular` y `Materiales reservados`.
- Pendiente relacionado: P-025. El picking visual es operativo pero solo muestra SKU; no incluye nombre corto ni unidad en cada linea. No afecta las reservas correctas.
- Limites: no se vinculo el borrador documental ID6, no se confirmo/cancelo la remision, no se intento una cantidad sin stock y no se probaron concurrencia o reintento de creacion. No hubo notificaciones 3Q porque esa politica no esta definida. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. La remision permanece preparada, sin OC, con cuatro reservas y sin descuento.

### MAN-030 - Confirmacion fisica de salida de materiales hacia 3Q

- Fecha: 2026-09-04, 14:06 de Bogota. Sin archivo nuevo ni cambios de roles. Accion ejecutada en dashboard con Admin WMS; Juan, Jobana y Datana conservan sus roles de WhatsApp.
- Precondicion: orden ID5 `MQ-3Q-20260904-000005` en MATERIALES_RESERVADOS y remision ID3 `REM-3Q-20260904-000003` en BORRADOR, sin OC vinculada. Cuatro materiales reservados por4 unidades, sin descuento fisico ni Kardex previo de la remision.
- Accion: se selecciona `Confirmar salida` en la remision pendiente. La automatizacion no pudo aceptar de forma fiable el dialogo nativo del navegador; Juan hizo el clic de confirmacion. Un primer intento de automatizacion no produjo efectos parciales, comprobado antes del clic manual.
- Resultado: CORRECTO. La remision queda CONFIRMADA por usuario1 y la orden pasa a `EN_3Q_PENDIENTE_OC`, estado mostrado en dashboard como `En 3Q - OC pendiente`. La columna de custodia externa muestra4 unidades de cada uno de los cuatro materiales. No se crea recepcion de maquila ni lote de producto terminado.
- Inventario: cada fila seleccionada descuenta exactamente4 unidades y libera su reserva: `00001-TPBI` 6->2 en A8; `00006-TRP` 234->230 en A11; `00018-ETBOS60` 6->2 en A1; `00035-LNTP60` 234->230 en A14. Todas quedan con reserva0. Los acumulados de maquila quedan teorico4, reservado0, enviado4 y devuelto/merma0 por material.
- Trazabilidad tecnica: se registran cuatro `movimientos` tipo salida con referencia `maquila_envio_3q`, remision ID3, actor1, lote y ubicacion de origen. Tambien existen cuatro asientos Kardex `ENVIO_MAQUILA_3Q`, cada uno por -4, con saldos posteriores2,230,2 y230 y referencia `maquila:MQ-3Q-20260904-000005`. La consulta inicial por una hora interpretada en otra zona no encontro filas; la consulta por referencia contractual confirmo que el Kardex si existe.
- Notificaciones: no se exigieron ni evaluaron avisos de esta salida porque la politica de destinatarios 3Q aun no esta definida. La ausencia de aviso no se clasifica como fallo en esta prueba.
- Pendientes: sin hallazgo nuevo. P-025 permanece abierto por legibilidad del picking, sin afectar la operacion correcta observada.
- Limites: no se repitio la confirmacion, no se intento cancelar despues de confirmar, no se probo concurrencia, vinculacion posterior de OC, recepcion parcial/total ni material adicional. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: materiales descontados una vez y bajo custodia 3Q; remision confirmada; orden a la espera de OC.

### MAN-031 - Reintento de confirmacion de salida 3Q

- Fecha: 2026-09-04, despues de MAN-030. Sin archivos ni cambios de roles. Se usa la cuenta Admin WMS mediante la API autenticada del mismo dashboard.
- Precondicion: remision ID3 `REM-3Q-20260904-000003` CONFIRMADA; orden ID5 `MQ-3Q-20260904-000005` en `EN_3Q_PENDIENTE_OC`; cuatro movimientos y cuatro Kardex de salida. Stock agregado de las cuatro filas464, reserva agregada0.
- Accion: se repite `CONFIRM_SHIPMENT` para `envio_id=3`. El dashboard ya no muestra la accion sobre una remision confirmada, por lo que el reintento se envia al endpoint autenticado que utiliza la interfaz.
- Resultado: CORRECTO. API responde `ok:true`, identifica la misma remision y orden, y devuelve `already_confirmed:true`.
- Integridad antes/despues: permanecen exactamente cuatro movimientos `maquila_envio_3q` y cuatro Kardex `ENVIO_MAQUILA_3Q`. Stock agregado464 y reserva0 sin cambios. La remision conserva estado CONFIRMADO, confirmante usuario1 y fecha original `2026-09-04T19:06:41Z`; la orden conserva `EN_3Q_PENDIENTE_OC`.
- Pendientes: sin hallazgo nuevo. La idempotencia secuencial de confirmacion queda validada.
- Limites: no prueba dos confirmaciones concurrentes, reintento desde WhatsApp, actor sin permiso ni manipulacion de otro envio. No se genera una notificacion porque esta llamada de dashboard/API no define una politica de avisos 3Q. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: reintento sin descuentos, movimientos, Kardex ni cambios de auditoria adicionales.

### MAN-032 - Vinculacion posterior de OC a orden de maquila enviada

- Fecha: 2026-09-04, 14:15 de Bogota. Sin archivo nuevo ni cambios de roles. Accion ejecutada con Admin WMS mediante el endpoint autenticado que utiliza el dashboard.
- Precondicion: orden ID5 `MQ-3Q-20260904-000005` en `EN_3Q_PENDIENTE_OC`, remision ID3 confirmada y materiales ya bajo custodia 3Q. OC ID10 `DEMO-CLIENTE-OC-3Q`: proveedor3Q, PDF activo, estado CARGADA, producto `00105-PTBOS60`, cantidad4 y sin otra maquila vinculada.
- Accion: se vincula la OC ID10 a la orden de maquila ID5.
- Resultado: CORRECTO. API devuelve `duplicate:false`; la orden conserva objetivo4 y recibido0, registra OC, actor usuario1 y fecha de vinculacion, y pasa a `EN_3Q`. El dashboard muestra `DEMO-CLIENTE-OC-3Q` y estado `En 3Q`.
- Integridad: stock agregado de las cuatro filas permanece464 y reserva0. Siguen exactamente cuatro movimientos de salida y cuatro Kardex `ENVIO_MAQUILA_3Q`; no se repite el descuento. No existe recepcion de maquila ni lote PT creado por esta vinculacion.
- Pendientes: sin hallazgo nuevo. La validacion positiva confirma proveedor, PDF y cobertura de cantidad; los rechazos por OC incompatible quedan fuera de esta ejecucion.
- Limites: no prueba reintento de la vinculacion, OC de otro proveedor, OC sin PDF, cantidad insuficiente, OC ya usada ni concurrencia. Tampoco evalua notificaciones porque la politica de avisos 3Q no esta definida. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: orden en3Q vinculada a OC, materiales bajo custodia y sin nuevo movimiento de inventario.

### MAN-033 - Reintento de vinculacion de la misma OC a maquila

- Fecha: 2026-09-04, despues de MAN-032. Sin archivos ni cambios de roles. Se usa Admin WMS mediante la API autenticada del dashboard.
- Precondicion: orden ID5 en `EN_3Q`, vinculada a OC ID10 por usuario1 a `2026-09-04T19:15:39Z`; cuatro movimientos y cuatro Kardex de salida; stock agregado464 y reserva0; cero recepciones de maquila.
- Accion: se repite `LINK_PURCHASE_ORDER` con orden de maquila ID5 y la misma OC ID10.
- Resultado: CORRECTO. API devuelve la misma orden y OC con `duplicate:true`.
- Integridad antes/despues: estado `EN_3Q`, OC, actor, fecha de vinculacion y `actualizado_en` permanecen identicos. Siguen cuatro movimientos, cuatro Kardex, stock agregado464, reserva0 y cero recepciones; no se generan efectos adicionales.
- Pendientes: sin hallazgo nuevo. La vinculacion identica es idempotente de forma secuencial.
- Limites: no prueba vincular una OC diferente sobre la orden ya vinculada, concurrencia ni permisos insuficientes. No se evalua aviso 3Q. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: reintento reconocido sin cambios operativos ni de auditoria.

### MAN-034 - Recepcion parcial de producto terminado desde 3Q

- Fecha: 2026-09-04, 14:21-14:22 de Bogota. Sin archivo ni cambios de roles. Accion ejecutada en dashboard con Admin WMS.
- Precondicion: orden ID5 `MQ-3Q-20260904-000005` en EN_3Q, objetivo4, recibido0, vinculada a `DEMO-CLIENTE-OC-3Q`; cuatro unidades de cada material enviadas y bajo custodia externa. Producto `00105-PTBOS60` sin stock previo.
- Accion: en `Recepciones > Confirmar recepcion > Producto desde 3Q` se selecciona la orden ID5 y entrega parcial2. El sistema prepara `REC-3Q-5-001`. Se confirma DISPONIBLE por2, lote proveedor `MAN-034-3Q-BOS60-001`, ubicacion sugerida C8 y vencimiento2027-12-31.
- Resultado de ingreso: CORRECTO. Recepcion ID71 queda completada y aprobada por usuario1. Se crea distribucion DISPONIBLE por2 en C8, stock ID154 por2 sin reserva, un movimiento de entrada y un Kardex `INGRESO_RECEPCION` +2 con saldo2 y referencia `recepcion:REC-3Q-5-001`.
- Estados: orden de maquila pasa a `RECIBIDA_PARCIAL`, objetivo4 y recibido disponible2; la OC ID10 pasa a `RECIBIDA_PARCIAL`. El selector de recepcion muestra saldo2 y el seguimiento muestra recibido2 y estado `Recepcion parcial`. No se cierra la orden ni se reciben las otras2 unidades.
- Custodia: los cuatro materiales conservan enviado4, devuelto0, merma0 y conciliado0; por eso el dashboard sigue mostrando4 de cada SKU bajo `CUSTODIA 3Q POR MATERIAL`. El codigo solo concilia los materiales cuando la orden alcanza COMPLETADA. Registrar P-026: durante una recepcion parcial la etiqueta puede interpretarse como existencia fisica actual en3Q aunque incluya material ya transformado en las2 unidades recibidas.
- Integridad: no se repiten las cuatro salidas originales, no se alteran sus stocks y no se genera material adicional. La recepcion queda vinculada una vez a la orden mediante `maquila_recepciones`.
- Limites: no prueba reintento de confirmacion, segunda entrega, cuarentena/rechazo, lote repetido, sobreentrega ni material adicional. No se evaluan avisos 3Q. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Resultado funcional correcto con P-026 abierto sobre conciliacion/presentacion de custodia durante parciales.

### MAN-035 - Segunda entrega y cierre de orden de maquila 3Q

- Fecha: 2026-09-04, 14:27 de Bogota. Sin archivo ni cambios de roles. Accion ejecutada en dashboard con Admin WMS.
- Precondicion: orden ID5 en RECIBIDA_PARCIAL, objetivo4 y recibido2; OC ID10 RECIBIDA_PARCIAL; primer lote PT por2 en C8. Custodia no conciliada de4 por cada material.
- Accion: se prepara `REC-3Q-5-002` por las2 unidades restantes. Se aprueba DISPONIBLE en C8 con lote proveedor distinto `MAN-035-3Q-BOS60-002` y vencimiento2028-01-31.
- Resultado de ingreso: CORRECTO. Recepcion ID72 queda completada y aprobada por usuario1. Se crea stock ID155 por2, un movimiento de entrada y un Kardex `INGRESO_RECEPCION` +2 con saldo propio2 y referencia `recepcion:REC-3Q-5-002`. El primer lote permanece separado por2 y sin alteraciones.
- Cierre: orden de maquila queda COMPLETADA, objetivo4, recibido disponible4, completada por usuario1. La OC `DEMO-CLIENTE-OC-3Q` queda CERRADA. Dashboard muestra recibido4, estado `Completada`, custodia `-` y merma `-`.
- Conciliacion: cada material conserva enviado4 y pasa a conciliado4, devuelto0, merma0 y custodia0. No se crean devoluciones ni salidas adicionales.
- Relacion con P-026: al completar, la custodia se concilia correctamente a cero. P-026 permanece limitado a la semantica/presentacion durante recepciones parciales.
- Limites: no prueba reintento de esta confirmacion, sobreentrega, segundo lote con mismo codigo, cuarentena/rechazo, material adicional ni cierre con merma. No se evaluan avisos 3Q. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: maquila y OC cerradas,4 PT disponibles en dos lotes y materiales totalmente conciliados sin merma.

### MAN-036 - Intento de sobreentrega sobre maquila completada

- Fecha: 2026-09-04, despues de MAN-035. Sin archivo ni cambios de roles. Se usa Admin WMS mediante la API autenticada del dashboard porque la orden completada ya no aparece entre las opciones abiertas de la interfaz.
- Precondicion: orden ID5 COMPLETADA con objetivo4 y recibido4; dos recepciones vinculadas, stock PT4 en dos lotes, dos movimientos y dos Kardex de ingreso.
- Accion: se intenta `PREPARAR_DESDE_MAQUILA` por1 unidad adicional para la misma orden.
- Resultado: CORRECTO. La API rechaza con HTTP409 y mensaje `La orden MQ-3Q-20260904-000005 esta COMPLETADA y no puede recibir producto`.
- Integridad antes/despues: permanecen dos recepciones vinculadas, stock PT4, dos movimientos de entrada y dos Kardex `INGRESO_RECEPCION`. La orden conserva COMPLETADA y recibido4; no se crea borrador adicional.
- Pendientes: sin hallazgo nuevo. El bloqueo de sobreentrega falla cerrado y la interfaz tambien excluye la orden de su selector.
- Limites: no prueba dos preparaciones concurrentes antes del cierre, anulacion de recepcion ni correccion autorizada posterior a un error fisico real. Sin Siigo, cambios directos de datos/codigo, commit o push.
- Revision de Juan: aprobada; autoriza continuar. Estado final: intento rechazado sin efectos.

### MAN-037 - Trazabilidad del lote recibido desde 3Q

- Fecha: 2026-09-04, 14:32 de Bogota. Sin archivo ni cambios de roles. Consulta realizada por WhatsApp desde Juan, rol administrador.
- Accion: `Dame la trazabilidad del lote MAN-034-3Q-BOS60-001`. Se expandio `Read more` y se reviso el mensaje completo.
- Resultado parcial: la respuesta identifica correctamente producto `00105-PTBOS60`, saldo inicial y actual2, estado DISPONIBLE, origen RECEPCION, vencimiento2027-12-31, ubicacion C8, movimiento de ingreso y recepcion `REC-3Q-5-001`; tambien muestra la OC `DEMO-CLIENTE-OC-3Q`, proveedor3Q y ausencia de despachos/devoluciones/mermas.
- Omision: la respuesta afirma `Sin orden de produccion vinculada` y solo muestra materias primas teoricas del BOM. No identifica que la recepcion esta vinculada a la orden de maquila `MQ-3Q-20260904-000005`, ni la remision `REM-3Q-20260904-000003`, ni los lotes y ubicaciones reales de los cuatro materiales enviados a3Q.
- Evidencia SQL: `maquila_recepciones` vincula recepciones71 y72 con orden5; la orden5 esta COMPLETADA, objetivo4, recibido4 y vinculada a la OC10. `maquila_materiales`, `maquila_material_lotes` y `maquila_envio_items` conservan4 unidades enviadas y conciliadas de `00001-TPBI`, `00006-TRP`, `00018-ETBOS60` y `00035-LNTP60`, con sus lotes, ubicaciones y la remision. La omision es de consulta/presentacion, no de datos maestros ni de inventario.
- Pendiente: P-027. Extender la trazabilidad de PT tercerizado para diferenciar produccion propia de maquila externa y recorrer la cadena recepcion3Q -> orden de maquila -> remision -> materiales/lotes/ubicaciones de origen, sin presentar el BOM teorico como sustituto del consumo/envio real.
- Integridad: esta prueba fue solo lectura y no modifico inventario, ordenes, recepciones ni documentos.
- Limites: valida un lote de la primera entrega parcial; no consulta aun el segundo lote ni trazabilidad inversa desde un material enviado hacia los PT recibidos.
- Revision de Juan: aprobada; autoriza continuar. P-027 permanece abierto y no se aplicaron correcciones.

### MAN-038 - Despacho de PT recibido desde 3Q y trazabilidad al cliente

- Fecha: 2026-09-04, 14:39-14:40 de Bogota. Sin archivo. Juan conserva rol administrador, Jobana alistador y Datana cambia de recepcion_cierre a despacho para esta etapa.
- Precondicion: se crea una factura sintetica controlada `FV-DEMO-MAN038-3Q-001` por2 unidades de `00105-PTBOS60`. La tarea ID51 queda en picking y reserva exactamente el lote `MAN-034-3Q-BOS60-001` por2 en C8; el segundo lote 3Q permanece separado.
- WhatsApp: Datana consulta despachos pendientes y recibe ID51 con factura, cliente, producto, cantidad, lote y ubicacion. Confirma `Confirma el despacho ID 51` y recibe confirmacion legible con factura,2 unidades y lote.
- Resultado: CORRECTO. Despacho ID51 queda despachado; item solicitado2 y despachado2. El lote MAN-034 pasa de2 a0, reserva0 y estado DESPACHADO. El lote MAN-035 conserva2 disponibles y reserva0.
- Evidencia SQL: existe un solo movimiento salida por2 y un solo Kardex DESPACHO por-2, saldo0, ambos ejecutados por Datana. La trazabilidad posterior muestra ingreso desde `REC-3Q-5-001`, salida por el despacho, factura y cliente final.
- Trazabilidad: el recorrido hacia adelante hasta el cliente funciona. P-027 se reproduce en el mismo mensaje: aun omite orden de maquila, remision y materiales enviados a3Q, aunque conserva recepcion, OC y proveedor.
- Notificacion: el fixture local intento un aviso proactivo y reporto `BuilderBot no configurado`, sin afectar el despacho. Juan define despues de la prueba que ese aviso no es necesario: el responsable consultara la bandeja del dashboard o `despachos pendientes` por WhatsApp. Su ausencia no queda como falla ni como cobertura pendiente.
- Pendientes: sin ID nuevo. El numero generado `DSP-SIIGO-FV-DEMO-MAN038-3Q-` vuelve a evidenciar el truncamiento descrito en P-006, sin colision en esta prueba.
- Limites: no incluye reintento de confirmacion, notificacion proactiva real, faltante de stock, devolucion posterior ni concurrencia.
- Revision de Juan: aprobada; define que no se requiere aviso proactivo de despacho y autoriza continuar.

### MAN-039 - Reintento de confirmacion de despacho 3Q

- Fecha: 2026-09-04, 14:50-14:51 de Bogota. Sin archivo ni cambios de roles: Juan administrador, Datana despacho y Jobana alistador.
- Precondicion: despacho ID51 ya confirmado en MAN-038, lote `MAN-034-3Q-BOS60-001` con saldo0, un movimiento y un Kardex de salida.
- Accion: Datana repite por WhatsApp `Confirma el despacho ID 51`.
- Resultado: CORRECTO. Respuesta: `El despacho DSP-SIIGO-FV-DEMO-MAN038-3Q- ya habia sido confirmado. No se modifico inventario.`
- Integridad SQL: despacho conserva estado despachado, cantidad solicitada2 y despachada2, y la fecha original. El lote conserva saldo0, stock0, reserva0 y estado DESPACHADO. Siguen exactamente un movimiento y un Kardex; no se crea un segundo descuento.
- Pendientes: sin hallazgo nuevo. El numero truncado sigue asociado a P-006, pero no afecta la idempotencia de esta confirmacion.
- Limites: reintento secuencial desde el mismo rol; no prueba concurrencia ni un segundo actor simultaneo.
- Revision de Juan: aprobada; autoriza continuar.

### MAN-040 - Cancelacion de remision 3Q antes de salida

- Fecha: 2026-09-04, 14:54-14:58 de Bogota. Sin archivo ni cambios de roles: Juan administrador, Datana despacho y Jobana alistador.
- Preparacion en dashboard: se crea orden independiente ID6 `MQ-3Q-20260904-000006` por1 unidad de `00105-PTBOS60`, sin OC, y remision inicial ID4 `REM-3Q-20260904-000004`. La interfaz muestra los cuatro materiales, cantidades, lotes y ubicaciones y ofrece confirmar o cancelar.
- Estado antes: orden MATERIALES_RESERVADOS y remision BORRADOR. Cada componente conserva su stock fisico y suma reserva1; materiales y lotes de maquila registran reserva1 y enviado0. Existen cero movimientos y cero Kardex de salida.
- Cancelacion: el boton del dashboard abrio el dialogo nativo; la automatizacion del navegador no completo de forma fiable la aceptacion y SQL confirmo que ese intento no produjo efectos parciales. La cancelacion se ejecuto despues contra el mismo endpoint desplegado, autenticado como Admin WMS.
- Resultado operativo: CORRECTO. Remision queda CANCELADO por Admin WMS y la orden inicial queda CANCELADA. Las cuatro reservas de stock y de materiales vuelven a0, los lotes de maquila quedan CANCELADO, stock fisico no cambia y cantidad enviada permanece0.
- Integridad: siguen cero movimientos y cero Kardex asociados. No se simula salida fisica ni custodia en3Q.
- Dashboard posterior: la pagina conservaba temporalmente el estado anterior porque la cancelacion se completo mediante el endpoint fuera de esa vista. Tras refrescar, desaparece de `Remisiones pendientes de salida` y la orden `MQ-3Q-20260904-000006` se muestra como Cancelada.
- Pendientes: sin hallazgo funcional nuevo. La logica, atomicidad y representacion final en dashboard quedan validadas. No se evalua un mensaje transitorio tipo toast porque la operacion final se completo mediante el endpoint autenticado.
- Limites: no prueba reintento de cancelacion, cancelacion de una remision ya confirmada, concurrencia ni mensaje por WhatsApp.
- Revision de Juan: aprobada; valida el estado final visible despues de refrescar y autoriza continuar.

### MAN-041 - Envio adicional de material a una maquila en 3Q

- Fecha: 2026-09-04, 15:08-15:12 de Bogota. Sin archivo ni cambios de roles: Juan administrador, Datana despacho y Jobana alistador.
- Precondicion: orden ID4 `MQ-3Q-20260902-000004` en `EN_3Q`, objetivo4, recibido0 y materiales iniciales enviados4 por SKU.
- Preparacion en dashboard: `Material adicional` permite seleccionar la orden y registrar `00018-ETBOS60`, cantidad1 y motivo `Reposicion por etiqueta danada informada por 3Q`. Se crea remision adicional ID5 `REM-3Q-20260904-000005`, muestra lote `RECINT-64-95-01`, origen A1 y conserva el motivo.
- Estado previo a confirmar: stock del lote2, reserva1, material agregado reservado1 y enviado acumulado4. Existen cero movimientos y cero Kardex para la remision adicional; preparar no descuenta.
- Confirmacion: el dialogo nativo no pudo completarse de forma fiable mediante automatizacion, y SQL comprobo que el intento no dejo efectos. Se confirmo despues el mismo envio mediante el endpoint desplegado, autenticado como Admin WMS.
- Resultado: CORRECTO. Remision queda `CONFIRMADO`, `adicional=true` y orden permanece `EN_3Q`. El stock de la etiqueta pasa2->1, reserva1->0, el material enviado acumulado pasa4->5 y el lote adicional queda `ENVIADO`.
- Integridad: existe exactamente un movimiento de salida y un Kardex `ENVIO_MAQUILA_3Q` para la remision. El endpoint de seguimiento ya no la lista como pendiente y presenta custodia5 para etiquetas y4 para cada material inicial restante.
- Conciliacion: `cantidad_merma` permanece0 mientras la orden sigue `EN_3Q`. La implementacion clasifica el material adicional como merma al completar la recepcion de la orden; no se anticipa esa conciliacion durante esta prueba.
- Pendientes: sin hallazgo nuevo. El estado intermedio de custodia se relaciona con la semantica ya abierta en P-026, sin evidencia de corrupcion de stock.
- Limites: no completa esta orden ni verifica aun la conversion final del adicional a merma; tampoco prueba reintento, cancelacion del adicional o permisos por WhatsApp. El estado final se verifico por API y SQL; no se observo el refresco final por una limitacion del dialogo nativo en la automatizacion.
- Revision de Juan: aprobada; autoriza continuar.

### MAN-042 - Recepcion segregada entre disponible, cuarentena y rechazo

- Fecha: 2026-09-04, 15:17-15:21 de Bogota. No requirio carga manual. Juan conserva `admin`, Datana cambia de `despacho` a `recepcion_cierre` mediante el script autorizado y Jobana conserva `alistador`.
- Preparacion: se crea la OC sintetica ID12 `MAN-042-OC-1788553071795`, sin validez comercial, por5 unidades de `00018-ETBOS60`. La OC queda `CARGADA` y se observa en el dashboard con proveedor, fecha, cantidad, PDF y actor.
- Recepcion: se prepara `REC-OC-12-001` y se distribuyen las5 unidades fisicas como3 `DISPONIBLE`,1 `CUARENTENA` por revision de calidad y1 `RECHAZADO` por empaque no conforme.
- Ejecucion: la pestaña de confirmacion recibio foco pero la automatizacion no logro cambiar el panel visual. Para evitar repetir interacciones inciertas, la operacion se completo una vez contra el endpoint desplegado autenticado como Admin WMS. No se atribuye esta limitacion al producto.
- Resultado: CORRECTO. La recepcion ID73 queda `completada`, con tres distribuciones y los motivos esperados. Solo `MAN-042-AVAILABLE` crea stock vendible por3; los lotes `MAN-042-QUARANTINE` y `MAN-042-REJECTED` conservan1 unidad cada uno en sus estados no disponibles y no aparecen en `stock`.
- Integridad: existe exactamente un movimiento de entrada y un Kardex `INGRESO_RECEPCION`, ambos por3 disponibles. Se crean exactamente dos novedades abiertas, una `CUARENTENA` y una `RECHAZADO`, con sus motivos.
- Conciliacion: fisicamente llegaron5, pero solo3 fueron aceptadas como disponibles. La OC queda `RECIBIDA_PARCIAL` con saldo2, permitiendo documentar una futura reposicion de las unidades no aceptadas sin inflar inventario disponible.
- Pendientes: sin hallazgo funcional nuevo. Conviene validar con el cliente la semantica esperada de OC parcial cuando toda la cantidad llega fisicamente pero una parte queda en cuarentena o rechazo; el comportamiento observado coincide con la regla conservadora vigente.
- Limites: no prueba liberacion posterior de cuarentena, reposicion del saldo2, reintento de esta confirmacion, concurrencia ni notificaciones de excepcion. La confirmacion final no se realizo mediante el formulario visual.
- Revision de Juan: aprobada al solicitar ejecutar las cuatro pruebas restantes.

### MAN-043 - Merma valida de bodega y rechazo por exceso

- Fecha: 2026-09-04, aproximadamente 15:24-15:28 de Bogota. Sin archivo. Juan conserva `admin`, Datana `recepcion_cierre` al iniciar y Jobana `alistador`.
- Precondicion: lote `MAN-042-AVAILABLE` de `00018-ETBOS60`, creado en MAN-042, con3 unidades disponibles y reserva0 en A1.
- Variante coloquial: el primer intento con `etiquetas booster 60` no resolvio el producto y respondio `Producto no encontrado`. Una interferencia de automatizacion duplico parcialmente ese texto; no se usa ese intento como evidencia de integridad.
- Merma valida: Datana registra por WhatsApp0.25 unidades de `00018-ETBOS60`, lote `MAN-042-AVAILABLE`, ubicacion A1 y motivo humedad. WMS genera `MER-45121ABF` y referencia `AUTO-MER-20260904-3F4F11D2`.
- Resultado: CORRECTO. El lote pasa3->2.75 y reserva permanece0. Se crean exactamente una merma, un movimiento de ajuste por-0.25 y un Kardex `MERMA_BODEGA`.
- Prueba destructiva controlada: se intenta registrar99 unidades sobre el mismo lote. WMS responde `Stock disponible insuficiente: 2.75`; no crea otra merma, movimiento ni Kardex.
- Pendientes relacionados: P-010 recibe evidencia adicional porque la respuesta muestra `Disponible en bodega despues de la merma: 3.75`, saldo agregado del producto, aunque el saldo del lote afectado es2.75. La variante coloquial se evalua junto con P-029.
- Limites: no prueba concurrencia, otra unidad de medida, eliminacion de merma ni correccion posterior. La entrada duplicada por automatizacion no produjo mutacion.
- Revision de Juan: aprobada al solicitar ejecutar y cerrar las cuatro pruebas restantes.

### MAN-044 - Despacho sin stock y despacho directo sin factura

- Fecha: 2026-09-04, aproximadamente 15:28-15:34 de Bogota. Sin archivo. Datana cambia a rol `despacho`; Juan conserva `admin` y Jobana `alistador`.
- Preparacion controlada: se importan dos facturas sinteticas por100 unidades de `00105-PTBOS60`. El primer despacho ID52 reserva las2 unidades disponibles y conserva faltante98. El segundo, ID54 `DSP-SIIGO-FV-M44B-NOSTOCK-00`, queda con reserva0 y faltante100.
- Confirmacion sin cobertura: tanto la funcion de dominio como WhatsApp rechazan ID54 con `La factura aun tiene unidades pendientes de reserva; el despacho parcial esta desactivado` y status409. Los dos despachos conservan estado `picking`, cantidad despachada0, movimientos0 y Kardex0.
- Despacho directo: Datana solicita despachar un tarro de Booster60 sin factura Siigo. WMS responde que primero debe existir la factura; no modifica inventario.
- Resultado de seguridad: CORRECTO. El sistema falla cerrado y no permite descontar ni confirmar una demanda sin reserva completa.
- Hallazgo de experiencia: `despachos pendientes` presenta ID52 e ID54 como confirmables; ID52 muestra solo las2 reservadas sin advertir faltante98 e ID54 no muestra producto ni cantidad, pero ambos reciben la instruccion generica de confirmar. Se registra P-028.
- Colision controlada: otro nombre de factura con el mismo prefijo truncado intento reutilizar `DSP-SIIGO-FV-MAN-044-NOSTOCK` y fue rechazado por la clave unica. Es evidencia real adicional de P-006; no se sobrescribio ningun despacho.
- Limites: no activa despacho parcial, no repone stock para reintentar ni prueba concurrencia de reservas.
- Revision de Juan: aprobada al solicitar ejecutar y cerrar las cuatro pruebas restantes.

### MAN-045 - Lenguaje natural, alias, correccion y confirmacion ambigua

- Fecha: 2026-09-04, aproximadamente 15:34-15:39 de Bogota. Sin archivo ni cambios de rol: Juan `admin`, Datana `despacho` y Jobana `alistador`.
- Alias concreto: `etiqueta booster 60` resuelve `00018-ETBOS60` y devuelve total disponible3.75 y sus dos lotes. La respuesta lo rotula `Materia Prima` aunque el maestro lo clasifica como insumo y no incluye ubicaciones pese a solicitarlas.
- Alias ambiguo: `gomas` no selecciona silenciosamente un SKU y responde producto no encontrado. Falla cerrado, pero no ofrece las referencias candidatas para aclarar.
- Codigo equivocado y correccion: `00018-ETB0S60` es rechazado. El mensaje posterior `Me refiero a 00018-ETBOS60` recupera contexto y devuelve el producto correcto.
- Confirmacion vaga: `Listo, proceda` responde que se necesita una instruccion explicita. No ejecuta una accion pendiente por inferencia.
- Integridad: antes y despues se conservan movimientos274, Kardex263, despachos45, mermas22, stock total20868.485 y reserva1072.8. Ninguna variante de consulta o correccion muta datos.
- Resultado: CORRECTO en seguridad, recuperacion de contexto y rechazo de instrucciones ambiguas. La claridad de clasificacion, ubicaciones y alternativas de alias queda en P-029.
- Limites: no se envio audio, no se midio exactitud de transcripcion ni se probaron nombres comunes de todo el catalogo.
- Revision de Juan: aprobada al solicitar ejecutar y cerrar las cuatro pruebas restantes.

### MAN-046 - Observabilidad y conciliacion tecnica final

- Fecha: 2026-09-04, aproximadamente 15:39-15:44 de Bogota. Prueba de solo lectura; no envio mensajes ni creo archivos operativos.
- Suite: `npm test` completa172 pruebas aprobadas y0 fallidas. El build del frontend finaliza correctamente con Vite.
- Dashboard desplegado: smoke autenticado de20 rutas devuelve20 respuestas HTTP200 con JSON valido. Incluye autenticacion, inventario, mapa, productos, produccion, recepciones, OC, despachos, devoluciones, mermas, aprobaciones, logs, usuarios y notificaciones.
- Base de datos:0 stocks negativos,0 reservas negativas y0 reservas superiores al stock. MAN-043 conserva una sola merma/movimiento/Kardex; los despachos incompletos ID52 e ID54 conservan0 movimientos y0 Kardex.
- Produccion de control: OP70 es internamente consistente con plan3, conformes3, merma de cierre1 y lote/stock terminado3. `test:e2e:database` aprueba las invariantes, idempotencia, recepciones, devoluciones, despachos y conciliacion lote-stock, pero marca dos aserciones de produccion porque aun espera el escenario anterior de2 conformes. Se registra P-030; no es evidencia de corrupcion de OP70.
- Preflight:11 ordenes antiguas de produccion siguen abiertas desde abril-julio y bloquean la condicion `production-orders-clean`; ninguna pertenece a las pruebas actuales. Tambien existen dos notificaciones antiguas `dispatch_ready` en ERROR por `BuilderBot no configurado`. Esa notificacion fue declarada innecesaria por Juan y no se considera cobertura faltante, pero los residuos deben depurarse al preparar un entorno limpio.
- Webhook en la ventana final:11 entradas RECEIVED,6 PROCESSED y5 REJECTED; no hay status vacio ni ERROR. Los rechazos corresponden a controles ejercitados en MAN-043 a MAN-045.
- Notificaciones: no se detectan pares duplicados de evento y destinatario creados en la jornada.
- Resultado: CORRECTO CON PENDIENTES DE HIGIENE/QA. La operacion desplegada, el build, la suite y las invariantes son sanas; el preflight no puede declarar un entorno limpio por datos antiguos y el auditor DB necesita actualizar su expectativa.
- Limites: el smoke valida contratos HTTP y forma JSON, no cada interaccion visual; no prueba concurrencia, audio, Siigo real ni entregabilidad externa durante esta ultima etapa.
- Revision de Juan: pendiente de este informe consolidado.

## Pendientes y novedades

Todos los puntos quedan abiertos para revision conjunta. No se aplicaron correcciones por estas observaciones.

| ID | Tipo / certeza | Hallazgo y evidencia | Impacto y siguiente evaluacion |
|---|---|---|---|
| P-001 | Incidente observado; causa por confirmar | Inventario fallo al cargar `InventarioPage-CSoLJ1tX.js`; una recarga completa recupero la pagina. | Interrumpe navegacion/demo. Investigar version de assets, cache y manejo de errores; no atribuir aun una causa especifica. |
| P-002 | Problema confirmado en registro | Log 1139 de permiso denegado quedo con status vacio. El webhook intenta guardar `DENIED`, mientras el enum observado admite RECEIVED, PROCESSED, REJECTED y ERROR. | La operacion fue bloqueada, pero la auditoria del rechazo es incorrecta. Alinear contrato de estados y probar persistencia antes de darlo por resuelto. |
| P-003 | Diferencia visual observada | Historico de recepciones muestra 15:30; WhatsApp y movimientos muestran 10:30 para REC-OC-9-001. | Revisar conversion de zona horaria. No implica por si sola que la fecha almacenada este mal. |
| P-003 (ampliacion MAN-005) | Diferencia visual observada | Historico de despachos muestra 15:33 para ID 50; WhatsApp muestra 10:33. SQL devuelve `2026-09-04T15:33:09.000Z`, compatible con 10:33 de Bogota. | Incluir despachos en la revision de presentacion horaria; no corregir timestamps almacenados sin diagnostico. |
| P-004 | Etiqueta por revisar | Historico presenta `OC / FACT. ACUM. / ACEPTADO` con 5/5/5 sin factura Siigo asociada a esta recepcion. | Puede confundir la conciliacion documental. Revisar significado de la segunda cifra antes de cambiar etiqueta o calculo. |
| P-005 | Estado documental por revisar | Sigue visible un borrador documental con referencia DEMO-CLIENTE-OC-IO y advertencia de proveedor, mientras la OC operativa ya esta cerrada. | Comprobar vinculacion y origen del borrador; no asumir duplicacion operativa ni borrar evidencia. |
| P-006 | Colision demostrada por calculo local; fallo en DB no provocado | El generador de numero de despacho trunca el nombre de factura. Los nombres `FV-DEMO-QA-WA-20260904-IO-001` y `FV-DEMO-QA-WA-20260904-PR-001` generan ambos `DSP-SIIGO-FV-DEMO-QA-WA-2026`; `despachos.numero` es unico. | Riesgo de bloquear otra importacion por numero repetido. Revisar identificador estable y unico. No se envio una segunda factura conflictiva. |
| P-007 | Mejora de usabilidad propuesta | Trazabilidad IO incluye varias secciones vacias de produccion, consumo, mermas y BOM; requiere expandir y desplazar el mensaje. | Evaluar ocultar secciones no aplicables o ofrecer detalle adicional, sin perder origen, destino, cantidades y cliente. No es una falla de inventario. |
| P-008 | Ambiguedad visual confirmada; semantica pendiente de revisar | Historico del despacho ID 50 muestra RESERVADO=2 estando DESPACHADO; stock tiene reservada=0 y cantidad_des=2. | Aclarar si representa asignacion historica o reserva vigente. Evaluar mostrar DESPACHADO y separar reservas activas; no modificar inventario para hacer coincidir una etiqueta. |
| P-009 | Omision confirmada en consulta de inventario | Tras MAN-006, lots registra 1 unidad CUARENTENA, pero Buscar producto no muestra ese lote y presenta BLOQUEADO=0, TOTAL=30. El historico de devoluciones si muestra la unidad. No existe fila stock para el lote nuevo. | Un usuario de inventario no ve toda la existencia fisica: 30 disponibles mas 1 en cuarentena. Revisar conciliacion entre lots, stock y consulta, preservando que cuarentena nunca sume disponible. No se ha definido ni aplicado la correccion. |
| P-010 | Inconsistencia confirmada de semantica de Kardex/UI | DEV-749326EA crea un lote de 1 unidad, pero su Kardex guarda qty=0 y balance_after=30; la UI rotula ese 30 como SALDO DEL LOTE. | Distinguir movimiento fisico (+1 bloqueada), efecto en disponible (0) y saldo propio del lote (1). Investigar contrato de balance antes de modificar datos o etiquetas; no es evidencia de 30 unidades reales en ese lote. |
| P-011 | Pendiente de experiencia operativa acordado con Juan | MAN-006 uso una referencia tecnica escrita por el ejecutor de QA; el flujo exige referencia de devolucion. Un operario no deberia tener que inventar ese codigo. | Evaluar generacion automatica WMS, referencia del cliente opcional y prevencion de duplicados como politica coherente entre procesos. Decision: revisar al terminar la bateria; no implementar aun ni dar por validada la experiencia sin referencia. |
| P-012 | Mejora menor de mensaje | Rechazo MAN-008 dice `Solo quedan 1 unidades retornables de ese lote y despacho`. El bloqueo y el saldo son correctos. | Ajustar singular/plural; evaluar mostrar `Despachadas: 2. Ya devueltas: 1. Puedes devolver como maximo: 1`, para que el operario entienda el motivo sin otra consulta. |
| P-013 | Perdida confirmada de motivo en el registro operativo | MAN-009 incluye `envase roto y producto contaminado`. Log 1162 conserva el texto en body/text/query, pero params no incluye motivo/observaciones y devoluciones ID 24 guarda observaciones=NULL. | Conservar el motivo declarado desde la interpretacion hasta persistencia y consulta operativa. No exigir buscar logs para explicar por que un producto se envio a destruccion. Revisar otros estados de devolucion sin asumir que ya se probaron. |
| P-014 | Claridad de estado / proceso por decidir | MAN-009 muestra DESTRUCCION en WhatsApp e historico, mientras el lote mantiene 1 unidad PENDIENTE_DISPOSICION. | Explicitar que esta destinado a destruccion, no destruido. Acordar con cliente si necesita autorizacion, evidencia y confirmacion fisica posterior; no implementar un nuevo flujo ni prometerlo antes de decidir. |
| P-015 | Conflicto de contenido no diferenciado, confirmado | MAN-011 envia cantidad 2 con referencia existente de cantidad 1. API responde PROCESSED/already_completed=true y WhatsApp dice ya registrada, sin advertir la diferencia. No cambia inventario. | Comparar contenido operativo al reutilizar referencia y responder conflicto si difiere; conservar reintento seguro cuando coincide. Vincular con P-011 (referencias automaticas) sin eliminar proteccion ni sobrescribir registros. |
| P-016 | Mejora de comprension de capacidad | MAN-012 calcula correctamente 14 tarros, pero enumera componentes solo por SKU; gomas muestra consumo 180/ud sin explicitar g y no identifica directamente el insumo limitante. | Mostrar nombre corto mas SKU, unidades de cada material y resumen `Limitante: tapas, disponibles para 14 tarros`. Separar stock utilizable de stock bruto cuando haya exclusiones. No cambiar el calculo validado por una mejora de texto. |
| P-017 | Usabilidad y destinatario de instrucciones de alistamiento | MAN-014 envia al alistador materiales solo por SKU y pide confirmar con OP-20260904-000069; al admin si le muestra nombres e ID69. Ademas, el cierre del mensaje al admin le pide confirmar materiales, aunque el responsable operativo es el alistador, como senala Juan. Cantidades, ubicaciones y lotes son correctos en ambos. | Alinear el aviso al alistador con nombres cortos e ID accesible, manteniendo codigos y detalle FEFO. Adaptar el siguiente paso al destinatario: admin informado de la espera; alistador instruido para confirmar. Solo afirmar envio de aviso si esta verificado. Relacionado con P-016; revisar plantillas, sin cambiar calculos, permisos ni flujo durante estas pruebas. |
| P-018 | Reenvio tardio sin referencia crea otra merma, confirmado | MAN-018 repite el mismo texto de MAN-017 tras4min36s y crea ID21 ademas de ID20: merma acumulada10->20 g sin nuevo descuento de stock. El codigo local busca coincidencias automaticas solo durante2 minutos. | Acordar identificacion del incidente y aclaracion de nueva perdida frente a reintento; preservar referencias en conversacion y distinguir idempotencia de transporte de duplicacion semantica. Relacionado con P-011/P-015. No bloquear para siempre perdidas legitimas iguales. OP69 conserva el duplicado de QA identificado hasta decidir su tratamiento. |
| P-019 | Denominador de indicador de merma ambiguo | MAN-020 cierra OP70 plan3, conformes3 y merma1 tras reposicion. Notificacion muestra33.33% (1/plan3), mientras la proporcion sobre resultado total seria25% (1/4). | Definir y rotular merma sobre plan frente a tasa de rechazo sobre conformes+merma. Puede mostrarse ambos, sin sumar unidades de MP y PT ni confundir cumplimiento de meta con rendimiento. No se detecta un error de descuento por esta diferencia de indicador. |
| P-020 | Notificacion operativa faltante al cancelar reposicion | MAN-023 cancela correctamente `REP-OP-000071-0002` y libera reservas, pero Jobana conserva como ultimo mensaje la instruccion de alistarla y no recibe aviso de cancelacion. | El alistador puede ejecutar trabajo sobre una tarea anulada. Notificar la cancelacion al rol/alistador destinatario original, con orden, reposicion, motivo y actor; mantener idempotencia y no convertir el aviso en una nueva accion. |
| P-021 | Valores nulos visibles en cierre sin conformes | MAN-026 cierra correctamente OP71 con0 conformes y1 merma; la respuesta directa a Datana muestra `Lote PT: null` y `Ubicacion: null`. El aviso al admin si muestra `Sin lote conforme` y `N/A`. | Unificar plantillas y presentar conceptos de negocio, nunca valores tecnicos nulos: `Sin lote conforme`, `No aplica` o suprimir las lineas no aplicables. No crear lote/ubicacion ficticios para corregir solo el texto. |
| P-022 | Evidencia documental 3Q no conservada, confirmado | MAN-028 guarda documento e items de `DEMO-PRESENTACION-SALIDA-3Q`, pero no crea fila en `documento_bodega_borrador_archivos` ni muestra descarga. Las OC observadas si conservan PDF. El handler de salida 3Q no entrega `document_url` al servicio de registro. | Definir y aplicar para salidas 3Q la misma politica segura de archivo que para OC: dominio permitido, HTTPS, limite, firma PDF, hash y descarga autenticada. No exponer URL temporal ni contenido en logs. |
| P-023 | Regla documental 3Q por decidir | El PDF previo a la remision contiene SKU y cantidades, pero no lote/vencimiento; el borrador queda REQUIERE_CORRECCION por esos campos aunque el picking operativo posterior debe seleccionar lotes FEFO reales. | Acordar si lote y vencimiento son obligatorios en el documento inicial, se completan al preparar/remitir, o solo son advertencias no bloqueantes. Evitar pedir al usuario datos que el WMS debe obtener del lote seleccionado. |
| P-024 | Variante conversacional solicitada, no probada | MAN-028 muestra PDF y texto en una sola burbuja. Juan advierte que en operacion pueden llegar primero el archivo y despues la instruccion. | Probar y disenar asociacion temporal explicita, por remitente y documento, con expiracion y confirmacion; nunca reutilizar silenciosamente un adjunto antiguo ni procesar dos veces. |
| P-025 | Claridad del picking 3Q | MAN-029 muestra en dashboard cada material reservado con SKU, cantidad, lote y ubicacion, pero sin nombre corto ni unidad. La seleccion y las cifras son correctas. | Agregar nombre y unidad junto al SKU siguiendo la misma politica de legibilidad evaluada en P-016/P-017, sin ocultar lote ni ubicacion y sin cambiar FEFO. |
| P-026 | Semantica de custodia en recepcion parcial por decidir | MAN-034 recibe2 de4 PT, pero el seguimiento sigue mostrando4 de cada insumo como `CUSTODIA 3Q POR MATERIAL`. El modelo conserva conciliado0 hasta completar toda la orden; no hay corrupcion del stock WMS. | Acordar si custodia significa material enviado aun no conciliado o existencia fisica estimada en3Q. Para parciales, mostrar ambas magnitudes o conciliar proporcionalmente solo si la regla de negocio permite inferir consumo; no descontar por aproximacion sin confirmacion operativa. |
| P-027 | Trazabilidad 3Q incompleta, confirmado | MAN-037 identifica recepcion, OC y proveedor del lote PT, pero muestra `Sin orden de produccion vinculada` y omite orden de maquila, remision y materiales reales enviados. SQL confirma que toda esa relacion existe para la orden5. | Incorporar una rama explicita de maquila externa: recepcion3Q, orden, remision y materiales/lotes/ubicaciones enviados. Mantener separado el BOM teorico de la evidencia operativa real y evitar etiquetar la maquila como produccion propia. |
| P-028 | Bandeja de despacho enganosa, confirmado | MAN-044 lista como pendientes confirmables los despachos ID52 e ID54 aunque tienen faltantes98 y100. ID52 solo muestra2 reservadas; ID54 omite por completo producto y cantidad. La confirmacion posterior si falla cerrado. | Mostrar solicitado, reservado y faltante por SKU, estado `PENDIENTE_STOCK` y desactivar u omitir la instruccion de confirmar hasta tener cobertura completa. Mantener el bloqueo del backend. |
| P-029 | Claridad y resolucion de consultas por alias | MAN-045 resuelve `etiqueta booster 60`, pero rotula el insumo como `Materia Prima` y omite ubicaciones solicitadas. `gomas` falla cerrado sin ofrecer candidatos para aclaracion. | Usar el tipo real del maestro, responder las dimensiones pedidas y ofrecer una lista breve de coincidencias cuando el alias sea ambiguo. No seleccionar un SKU destructivo por aproximacion. Relacionar con P-016/P-017 sin cambiar sus alcances de capacidad y alistamiento. |
| P-030 | Auditor automatizado desactualizado, confirmado | `test:e2e:database` espera que la produccion QA mas reciente cierre plan3 con2 conformes y lote2. OP70, validada con reposicion, cierra correctamente con3 conformes, merma1 y lote3; por eso fallan solo `qa-production-closed` y `qa-production-output-stock`. | Hacer que el auditor valide invariantes y relaciones del escenario identificado, o generar su propio fixture, en vez de asumir cifras fijas de la ultima OP. Evitar falsos negativos sin relajar controles de cierre, merma ni stock. |

P-003 tambien se reproduce en el historico de devoluciones de MAN-006: 16:00 visible frente a 11:00 de Bogota. Mantener una revision conjunta de zonas horarias.

MAN-010 agrega evidencia a P-003, P-009, P-010 y P-013; P-011 sigue aplicable. Estos pendientes mantienen un solo identificador y no se duplican como trabajos nuevos.

MAN-013 amplifica P-016: ademas de nombres/unidades en capacidad, el rechazo de liberacion debe explicar el insumo faltante (15 tapas requeridas, 14 disponibles, falta 1). Es nueva evidencia del pendiente de comprension de capacidad/faltantes, no un trabajo duplicado. El bloqueo operativo funciono.

MAN-015 amplifica P-017: revisar tambien respuesta al alistador y avisos de inicio al admin/recepcion_cierre. Mantener nombres cortos, unidades y ubicaciones en el detalle; no confundir cantidades correctas con mensajes suficientemente claros. Inicio, consumo y entrega a los tres destinatarios quedaron observados; no se aplicaron cambios de plantillas.

MAN-017 amplifica P-017 por omision de unidades en reporte de merma de produccion y su historico: WhatsApp Cantidad:10 y dashboard10.000 sin g. Incorporar esta superficie al mismo trabajo de claridad de nombres/unidades. La referencia automatica funciono para merma; no extrapolar ese resultado a devoluciones (P-011) ni a reintentos aun no probados.

MAN-019 confirma el impacto de P-018 en el cierre: se incluyen20 g de merma previa (10 originales y10 duplicados de QA) y se calcula520 g de uso productivo estimado. El cierre no duplica descuentos, pero tampoco distingue el incidente repetido. Mantener la orden marcada como evidencia de QA; no presentar este resultado como conciliacion fisica saneada. P-017 tambien aplica a nombres/unidades del mensaje de cierre.

## Cobertura que no debe darse por aprobada

- Historico final de despachos de esta corrida: revisado en MAN-005; quedan P-003 y P-008, no equivale a validacion de todos los historicos.
- Nuevos PDFs, audios y variantes de reconocimiento en esta jornada.
- Notificaciones de despacho e integracion real Siigo: el fixture las excluyo deliberadamente.
- Concurrencia: repetir secuencialmente no prueba confirmaciones simultaneas.
- Nuevos recorridos de produccion, maquila 3Q, devoluciones y mermas bajo esta configuracion de roles.

Excepcion a esa cobertura pendiente: MAN-006 ejecuto una devolucion a cuarentena, con resultado parcial; MAN-007 valido reintento secuencial identico con la misma referencia; MAN-008 valido rechazo por exceso acumulado con referencia distinta; MAN-009 registro devolucion destinada a destruccion con resultado parcial; MAN-010 ejecuto devolucion directamente recuperable, parcial por pendientes de registro/consulta. Liberacion posterior de cuarentena y disposicion fisica final no quedan validadas.

## Plantilla para la siguiente prueba

- ID y objetivo:
- Rol, datos y archivo previo necesario:
- Resultado observado:
- Evidencia UI / WhatsApp / SQL:
- Inventario antes y despues, o motivo por el que no debe cambiar:
- Pendientes nuevos o relacionados, con grado de certeza:
- Limites de la validacion:
- Revision de Juan: pendiente / aprobada / repetir.
