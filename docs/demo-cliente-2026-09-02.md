# Guion de demo WMS - 2026-09-02

## Objetivo

Mostrar que el WMS distingue y controla tres recorridos operativos sin perder trazabilidad:

1. Produccion interna (`PR`): recepcion de insumos, consumo en produccion, producto terminado y despacho.
2. Entrada y salida (`IO`): recepcion de producto terminado y despacho, sin crear una orden de produccion.
3. Maquila tercerizada (`PT`): envio controlado de materiales a 3Q, custodia externa, recepciones parciales y despacho del producto terminado.

El mensaje central de la demostracion es que cada movimiento conserva documento de origen, responsable, lote, ubicacion, cantidad, estado y siguiente destino.

## Duracion recomendada

| Bloque | Duracion |
|---|---:|
| Contexto y tablero principal | 2 minutos |
| Produccion interna punta a punta | 8 minutos |
| Producto in-and-out | 4 minutos |
| Maquila tercerizada 3Q | 8 minutos |
| Trazabilidad y cierre | 3 minutos |
| Total | 25 minutos |

## Datos de demostracion

Se utilizaran los SKU reales del cliente. Los documentos, lotes y referencias transaccionales creados para la sesion deben comenzar por `DEMO-20260902` para distinguirlos y limpiarlos facilmente despues.

La demostracion no se conectara con Siigo ni creara documentos en ese sistema. Cuando el recorrido necesite un documento contable de origen, el WMS utilizara una compra o venta demo precargada que simula la futura importacion, sin modificar productos, BOM ni otros datos maestros.

## Decisiones cerradas para esta demostracion

1. La OP de produccion interna se creara exclusivamente para **stock de seguridad**.
2. No se demostrara la creacion de una OP para un pedido de cliente.
3. Como regla provisional de negocio, una OP para pedido de cliente debera vincularse y cotejarse contra una OC emitida por ese cliente antes de liberarse.
4. Ese cotejo documental todavia no esta implementado. El comportamiento actual de guardar una referencia y un cliente no se presentara como validacion de una OC.
5. Las decisiones sobre carga de la OC del cliente por dashboard o WhatsApp, aprobacion, parcialidades y limites de cantidad se resolveran despues del demo con el feedback del cliente.
6. Las posiciones del plano del cliente son ubicaciones preferidas, no bloqueos exclusivos. Un producto puede tener varias posiciones y una posicion puede contener varios SKU.
7. La ubicacion sugerida agiliza la recepcion, pero la persona que recibe confirma la ubicacion fisica real. Cuarentena y rechazo conservan sus ubicaciones operativas separadas.

## Bitacora de pasos validados

Actualizar esta seccion durante los ensayos. Solo se marca como validado aquello que haya producido la respuesta esperada y haya sido comprobado en el WMS o la base de datos.

| Paso | Estado | Evidencia funcional |
|---|---|---|
| Enviar una OC en PDF por WhatsApp | Validado | El agente crea un borrador, informa items y total, y no modifica inventario. |
| Revisar el borrador de OC en dashboard | Validado | El dashboard muestra PDF, proveedor, fecha, SKU, cantidades y unidades antes de crear la OC operativa. |
| Crear la OC operativa desde el borrador revisado | Validado | La OC queda `CARGADA` y disponible para recepcion fisica. |
| Consultar recepciones pendientes por WhatsApp | Validado | El agente lista opciones con ID corto, OC, proveedor e items pendientes. |
| Preparar una recepcion mediante ID corto | Validado | El agente devuelve el resumen de productos y los datos fisicos requeridos. |
| Registrar y confirmar la recepcion fisica | Validado | La recepcion se confirma una sola vez, registra todos los items y actualiza inventario de forma atomica. |
| Cargar posiciones preferidas del cliente | Validado en base de datos | Se crearon 77 posiciones y 83 asignaciones activas para 48 productos, sin mover stock existente. |
| Mostrar el plano del cliente con stock demostrativo | Validado | El mapa separa las secciones A-D de las ubicaciones anteriores y muestra producto asignado, lote y stock fisico en 12 posiciones demostrativas. |
| Sugerir ubicacion al preparar una recepcion | Pendiente de despliegue y ensayo final | Dashboard y WhatsApp deben mostrar la primera posicion preferida y permitir seleccionar otra. |
| Solicitar produccion usando un nombre comun | Validado | `tarros de ashwagandha 60` resuelve `00102-PTASH60`. |
| Solicitar produccion sin indicar destino | Validado | El agente pregunta si corresponde a stock de seguridad o pedido de cliente y no crea una OP. |
| Liberar una OP para stock de seguridad | Validado | La OP oficial del ensayo es ID 67 / `OP-20260902-000067`: 3 unidades, cinco componentes BOM y reservas FEFO verificadas en base. |
| Liberar reservas de OP de ensayo anteriores | Validado | Las OP 63 y 64 quedaron canceladas antes de iniciar, sin movimientos ni kardex, y sus 12 asignaciones fueron liberadas. |
| Responder solamente `pedido de cliente` | Validado como control | El agente solicita referencia y cliente final; este recorrido queda excluido del demo porque aun no coteja una OC almacenada. |
| Confirmar materiales e iniciar la OP del ensayo final | Validado | La frase natural `Ya aliste los materiales de la orden ID 67` inicio la OP, consumio exactamente las reservas FEFO, genero seis registros de Kardex y notifico al administrador. |
| Ver el consumo de insumos en Inventario > Buscar producto | Validado | La version desplegada muestra en `Movimientos recientes` la fecha y hora local, cantidad negativa, lote, referencia `produccion:OP-20260902-000067` y saldo del lote. Se comprobo con `00017-ETASH60` y `00051-MPASH`. |
| Registrar merma de proceso con lenguaje natural | Validado | `En la orden 67 se perdieron 10 gramos de goma por derrame` resolvio el alias `goma`, genero `AUTO-MER-20260902-28CDD373` y registro una sola merma de 10 g de `00051-MPASH` en la OP 67. |
| Cerrar la OP del ensayo final | Validado | La primera frase sin ubicacion no modifico inventario y solicito solo ese dato. Al responder `C2`, cerro la OP 67 con 2 conformes y 1 merma, genero `LPN-OP-20260902-000067`, heredo vencimiento `2026-09-30`, creo 2 unidades disponibles en `C2` y notifico al administrador una sola vez. Juan confirmo manualmente la recepcion del mensaje con plan, resultado, merma, lote PT y conciliacion completa. |
| Recorrido IO del demo | Pendiente de ensayo final | Debe recibir PT directamente y despacharlo sin crear OP. |
| Recorrido de maquila 3Q del demo | Pendiente de ensayo final | Debe cubrir remision, salida, recepcion parcial y trazabilidad externa. |

| Recorrido | Referencia real | Uso en el demo |
|---|---|---|
| Produccion interna | `00102-PTASH60` | Ashwagandha x 60 producida dentro de Infinity. |
| In-and-out | `00276-PTZNASHWA` | Zenova Ashwagandha recibida como producto terminado. |
| Maquila 3Q | `00105-PTBOS60` | Booster x 60 empacado por un tercero. |

Cantidades sugeridas:

- Produccion interna: 3 unidades planeadas, 2 conformes y 1 merma.
- In-and-out: recibir 5 unidades y despachar 2.
- Maquila 3Q: objetivo de 4 unidades; recibir primero 3 y luego 1 para mostrar parcialidad.

## Lineas y rotacion de roles

| Linea | Uso durante toda la demo |
|---|---|
| `573173292904` | Linea del agente. No se asigna como usuario operativo. |
| `573174442659` | Juan; conserva el rol `admin` y opera el dashboard como Sofi. |
| `573125031367` | Linea humana rotativa; cambia de rol segun la fase. |

La linea rotativa se utilizara en este orden:

| Momento | Rol efectivo | Acciones que se demuestran |
|---|---|---|
| Inicio | `recepcion_cierre` | Confirmar recepciones de insumos y producto `IO`. |
| Produccion preparada | `alistador` | Confirmar materiales e iniciar la OP interna. |
| Cierre y 3Q | `recepcion_cierre` | Cerrar produccion y confirmar recepcion parcial desde 3Q. |
| Salidas finales | `despacho` | Confirmar los despachos preparados. |
| Fin de la demo | `recepcion_cierre` | Restaurar el rol inicial de la linea. |

Reglas de operacion:

1. Cambiar el rol mediante la API administrativa, que actualiza MySQL y registra la operacion en `system_logs`.
2. Consultar inmediatamente el usuario y confirmar el rol efectivo antes de enviar el siguiente mensaje.
3. No cambiar el rol de Juan ni registrar la linea del agente como usuario.
4. La linea rotativa operara por WhatsApp. Si se utiliza para ingresar al dashboard, debe cerrar sesion y volver a autenticarse despues de cada cambio de rol para refrescar sus capacidades visuales.
5. No cambiar el rol mientras exista una accion en curso o una respuesta pendiente del agente.

## Apertura

1. Ingresar al dashboard y mostrar el plano de operaciones.
2. Explicar que la demostracion se concentra en el control fisico del WMS. La conexion con el sistema contable del cliente no se utilizara durante la sesion.
3. Mostrar las modalidades de producto en el catalogo: `PR`, `PT` e `IO`.
4. Aclarar que WhatsApp y dashboard llaman la misma logica y respetan los mismos permisos.
5. Abrir `Inventario > Mapa Bodega > Bodega Principal > Plano del cliente`.
6. Explicar que A, B, C y D son secciones del plano y que cada codigo completo (`A1`, `B13`, `C2`, etc.) identifica una ubicacion fisica.
7. Entrar a `B16` para mostrar gomas Ashwagandha en gramos y a `C2` para mostrar producto terminado Ashwagandha x 60.
8. Señalar la diferencia entre `Asignacion prevista` y `Stock fisico`; una asignacion no crea inventario por si sola.

## Escenario 1: produccion interna

Referencia: `00102-PTASH60` - PRODUCTO TERMINADO ASHWAGANDHA X 60.

### 1. Recepcion de insumos

1. Mostrar una OC cargada con su PDF.
2. Mostrar el documento de compra demo precargado que representa el futuro origen contable.
3. Confirmar la recepcion fisica de los insumos.
4. Distribuir cantidades entre disponible, cuarentena o rechazo y asignar lote, vencimiento y ubicacion.
5. Mostrar que el WMS sugiere la posicion preferida del producto, pero permite registrar otra posicion real.
6. Verificar que solo la cantidad aceptada como disponible habilita produccion.

Mensaje para el cliente: el sistema conserva por separado lo ordenado, lo facturado y lo recibido fisicamente.

### 2. Liberacion y alistamiento

1. Juan dice por WhatsApp: `Vamos a producir tres tarros de ashwagandha 60`.
2. El agente debe preguntar si la produccion es para stock de seguridad o para un pedido de cliente. No debe crear una OP en este punto.
3. Juan responde: `Para stock de seguridad`.
4. Verificar que la respuesta confirme `3` unidades de `00102-PTASH60`, muestre el BOM calculado y la reserva FEFO por lote y ubicacion.
5. El Alistador confirma materiales e inicio de produccion mediante el ID corto devuelto por el agente.
6. Mostrar el cambio de stock de bodega a material en proceso y la notificacion a administracion.
7. Abrir `Inventario > Buscar producto` y buscar `00017-ETASH60`: el Kardex debe mostrar un consumo de 3 unidades asociado a `produccion:OP-20260902-000067`.
8. Buscar `00051-MPASH`: el Kardex debe mostrar el consumo FEFO dividido en 284.25 g y 255.75 g entre los dos lotes utilizados.

Mensajeria que debe mostrarse durante este paso:

| Momento | Quien envia | Quien recibe | Contenido esperado |
|---|---|---|---|
| Liberacion de la OP | Sofi/administrador | Sofi/administrador | ID corto, codigo OP, producto, cantidad interpretada, origen y alistamiento FEFO por lote y ubicacion. |
| Aviso de alistamiento | Sistema | Alistador | Codigo OP, producto, cantidad y lista de materiales que debe preparar. |
| Confirmacion de materiales | Alistador | Alistador | Confirmacion de la OP en proceso y detalle de los materiales alistados. |
| Inicio de produccion | Sistema | Sofi/administrador | Codigo OP, SKU, nombre del producto, cantidad planeada, origen, quien confirmo, fecha, hora, materiales consumidos y estado `EN_PROCESO`. |

Frase natural validada para el alistador:

> Ya aliste los materiales de la orden ID 67

No es necesario dictar el codigo largo `OP-20260902-000067` ni usar una frase rigida. El ID corto debe resolver una sola orden activa.

Resultado esperado del alistamiento para este ensayo:

- `00006-TRP`: 3 und de `RECINT-60-83-01`, ubicacion `PPAL-A-1-01`.
- `00001-TPBI`: 3 und de `RECINT-60-82-01`, ubicacion `PPAL-A-1-01`.
- `00017-ETASH60`: 3 und de `WMSFLOW-QA-00017-ETASH60`, ubicacion `PPAL-A-1-01`.
- `00035-LNTP60`: 3 und de `RECINT-60-85-01`, ubicacion `PPAL-A-1-01`.
- `00051-MPASH`: 540 g en total; 284.25 g de `TEST_AGENT-MPASH-FIFO-NEW` en `PPAL-A-1-02` y 255.75 g de `DEMO-GOMAS-001` en `PPAL-A-1-01`.

#### Definicion posterior al demo: produccion para un pedido

No recorrer esta variante durante la demostracion. La decision provisional es que una OP para pedido de cliente debe vincularse y cotejarse contra una OC del cliente. Las siguientes preguntas quedan registradas para recoger feedback al terminar el demo o en una sesion posterior.

Pregunta para confirmar con el cliente:

> Cuando una orden de produccion se crea para atender un pedido de cliente, ¿debe estar obligatoriamente vinculada y cotejada contra una orden de compra emitida por ese cliente?

Aclaracion para evitar confusiones: esta seria la orden de compra del **cliente final hacia GummyBox**, no la orden de compra que GummyBox emite a sus proveedores para adquirir materia prima.

Preguntas complementarias:

1. Si la OC del cliente es obligatoria, ¿se debe impedir la creacion o liberacion de la OP mientras no se haya registrado?
2. ¿La OC se cargaria como PDF desde el dashboard, se enviaria por WhatsApp al agente o se permitirian ambos canales?
3. ¿Quien debe revisar y aprobar los datos extraidos antes de que la orden quede disponible para produccion?
4. ¿Una misma OC puede atenderse mediante varias OP parciales?
5. ¿Las cantidades acumuladas de las OP deben limitarse a la cantidad solicitada? Si se permite producir de mas, ¿quien autoriza la diferencia?
6. ¿Que datos minimos deben capturarse: numero de OC, cliente final, SKU, cantidad, fecha requerida y observaciones?

Estado actual que no debe presentarse como funcionalidad terminada: el WMS puede solicitar una referencia y un cliente final, pero esa referencia todavia no se coteja automaticamente contra una OC de cliente almacenada.

### 3. Ejecucion y cierre

1. Registrar, si se desea, una entrega adicional o devolucion de material.
2. Registrar una merma de proceso indicando la orden, el insumo mediante SKU o alias, la cantidad y el motivo. El WMS genera la referencia; el operario no necesita conocer lote ni ubicacion porque el material ya fue consumido al iniciar la OP.
3. Nelly cierra la OP con 2 unidades conformes y 1 de merma, indicando la ubicacion. No dicta el lote ni el vencimiento del producto terminado: el WMS genera el lote y hereda el vencimiento mas proximo de las gomas consumidas.
4. Mostrar la conciliacion entre BOM teorico, material entregado, devoluciones, merma y uso productivo.
5. Verificar la creacion del lote de producto terminado y su ubicacion.

Mensajeria esperada para el cierre:

| Momento | Quien envia | Quien recibe | Contenido esperado |
|---|---|---|---|
| Merma durante el proceso | Alistador | Alistador | Referencia generada por el WMS, insumo, cantidad, motivo y OP asociada; no debe descontar nuevamente el material ya consumido. |
| Cierre de produccion | Nelly/recepcion y cierre | Nelly/recepcion y cierre | Codigo OP, conformes, merma de producto terminado, lote PT, vencimiento y ubicacion. |
| Produccion terminada | Sistema | Sofi/administrador | Plan, conformes, merma y porcentaje, motivo, lote PT, ubicacion, vencimiento, quien cerro y conciliacion de materiales. |

Frase natural del ensayo de cierre:

> Cerramos la orden 67 con 2 tarros conformes y 1 tarro de merma por daño de empaque. Los conformes quedan en C2.

El WMS debe generar el lote terminado con formato `LPN-OP-...`, calcular su vencimiento usando el vencimiento mas proximo entre los lotes de gomas consumidos, mostrar ambos datos en la respuesta y crear el stock una sola vez. Nelly no necesita conocer esos valores antes del cierre.

Observacion del ensayo: la operacion demuestra correctamente el registro separado de 10 g de merma de proceso y 1 unidad no conforme al cierre. Se consumieron exactamente 3 juegos de envase, tapa, etiqueta y liner; la unidad no conforme es una de esas tres y no descuenta un cuarto juego. El balance de gomas no puede determinarse por completo sin conocer cuanto contenido quedo en la unidad no conforme, si fue recuperado y si existieron sobrantes. No presentar `uso productivo estimado` como consumo exacto de las unidades conformes.

Terminologia para la demostracion: al confirmar materiales, el WMS descuenta el material del stock disponible porque fue **entregado a produccion** y ya no puede asignarse a otra orden. El Kardex historico lo denomina `CONSUMO_MATERIAL`, pero esto no prueba por si solo que todo haya sido incorporado fisicamente. Antes del cierre, el material no usado debe devolverse a bodega; el material derramado se registra como merma de proceso; y el contenido de una unidad terminada no conforme debe clasificarse como descartado o recuperado segun lo que realmente ocurra.

Pregunta para el cliente durante el demo:

> ¿Una merma reportada durante la produccion debe avisarse inmediatamente a Sofi o Nelly, o es suficiente incluirla en la conciliacion enviada al cerrar la orden?

> ¿Que tolerancia de peso aceptan por unidad y quien debe resolver una conciliacion donde el material entregado no cubre simultaneamente las unidades terminadas y la merma de proceso reportada?

> Cuando un tarro terminado queda no conforme por daño de empaque, ¿las gomas de su interior se desechan, se recuperan para reproceso o se devuelven como materia prima? ¿Quien confirma esa decision y como se cuantifica?

> Si una unidad terminada queda no conforme, ¿la OP puede cerrarse con menos unidades conformes que las planeadas o debe mantenerse abierta y autorizar el alistamiento de otro juego de materiales para fabricar un reemplazo? Si se reemplaza, ¿quien lo autoriza y la nueva entrega se registra como consumo adicional de la misma OP?

Pregunta de decision para formular en este punto de la demostracion:

> Cuando el cierre reporta menos unidades conformes que la cantidad planeada, ¿como quieren que actue el WMS: cerrar con el faltante, mantener automaticamente la OP abierta y proponer los materiales de reposicion, o pedirle a Sofi que elija entre ambas opciones en cada caso? ¿La regla debe cambiar cuando la OP corresponde a un pedido de cliente frente a una produccion para stock de seguridad?

Recomendacion provisional basada en practicas de MRP/MES:

1. Tratar la cantidad planeada de la OP como objetivo de unidades conformes, no como numero maximo de intentos.
2. Registrar por separado unidades conformes, unidades rechazadas o scrap y cantidad conforme pendiente.
3. Si las conformes son menores que el plan, no cerrar automaticamente. Ofrecer dos decisiones explicitas: `mantener abierta y reponer` o `cerrar con faltante`.
4. Si se decide reponer, conservar la misma OP, registrar la unidad no conforme y calcular un alistamiento adicional con el BOM de la cantidad faltante. Ese material debe quedar identificado como entrega adicional y requerir autorizacion antes de afectar stock.
5. Si se decide cerrar con faltante, registrar quien lo autorizo, el motivo y la diferencia contra el plan. Para una OP vinculada a pedido de cliente, la opcion recomendada es mantener abierta o crear una continuacion/backorder hasta completar la demanda.
6. No asumir que todos los componentes de la unidad rechazada deben reponerse: antes se debe definir cuales se desecharon y cuales se recuperaron.

Referencias revisadas: Microsoft Dynamics 365 separa cantidad buena y cantidad de error al reportar produccion terminada y permite reportes parciales; Odoo permite registrar scrap de componentes o producto terminado, advierte diferencias de consumo y crea ordenes de continuacion para cantidades pendientes; Oracle separa cantidades completadas, rechazadas y scrap.

Estado para la demo: la politica que decide automaticamente entre cerrar con faltante o reponer **no esta definida** y debe presentarse como punto de validacion con el cliente. La capacidad operativa de reposicion se incorporo de forma explicita y reversible: Sofi prepara una reposicion, el WMS reserva por FEFO y el Alistador confirma antes de descontar. Debe completarse un ensayo vivo antes de presentarla como validada.

#### Flujo de reposicion incorporado

1. La OP debe continuar `EN_PROCESO`; no se cierra al detectar la unidad no conforme.
2. Sofi indica la OP, la cantidad de unidades conformes faltantes, el motivo y confirma expresamente que se repondra el BOM completo. El WMS no debe asumir esta ultima decision porque algunos componentes podrian recuperarse.
3. `PREPARAR_REPOSICION_PRODUCCION` calcula las cantidades desde el BOM congelado en la OP, reserva lotes FEFO y notifica al Alistador. Preparar no descuenta inventario.
4. El Alistador confirma mediante el ID corto de reposicion o de orden. `CONFIRMAR_REPOSICION_PRODUCCION` descuenta exactamente las reservas, registra la entrega como adicional y avisa a Sofi y Nelly. La OP permanece `EN_PROCESO`.
5. Si Sofi cambia de decision antes del alistamiento, `CANCELAR_REPOSICION_PRODUCCION` libera las reservas. Una reposicion ya confirmada no se puede cancelar.
6. La OP no puede cerrarse mientras exista una reposicion pendiente. Preparar, confirmar y cancelar son idempotentes frente a reintentos inmediatos.

Mensajeria esperada:

| Momento | Quien envia | Quien recibe | Contenido esperado |
|---|---|---|---|
| Autorizacion | Sofi/administrador | Sofi/administrador | Codigo de reposicion, OP, unidades conformes faltantes, motivo y materiales reservados por FEFO. |
| Aviso de reposicion | Sistema | Alistador | Codigo corto, OP, objetivo adicional y picking con SKU, cantidad, lote y ubicacion. |
| Confirmacion | Alistador | Alistador | Reposicion confirmada y materiales entregados; la OP sigue en proceso. |
| Material adicional entregado | Sistema | Sofi y Nelly | Reposicion, OP, quien confirmo y detalle de lotes y cantidades adicionales. |

Frase natural sugerida para Sofi:

> Autoriza reponer todos los materiales para fabricar 1 unidad faltante de la orden ID 67 por daño de empaque.

Frase natural sugerida para el Alistador:

> Ya aliste la reposicion de la orden ID 67.

Frase natural del ensayo de merma de proceso:

> En la orden ID 67 se perdieron 10 gramos de gomas ashwa por derrame.

El operario no debe conocer ni inventar un codigo. El WMS genera una referencia `AUTO-MER-...` y la devuelve en la confirmacion. Si existe una referencia real en un formato fisico, el operario puede indicarla y el sistema la conserva.

### 4. Despacho

1. Mostrar una venta demo precargada, sin realizar llamadas a Siigo.
2. Mostrar la tarea de despacho con cliente final, cantidades, lote FEFO y ubicacion.
3. Anderson confirma la salida fisica.
4. Verificar que el inventario se descuenta una sola vez y queda asociado a factura, despacho y cliente.

## Escenario 2: producto in-and-out

Referencia: `00276-PTZNASHWA` - PRODUCTO TERMINADO ZENOVA ASHWAGANDHA.

### Preflight verificado el 2026-09-02

Se revisaron codigo, pruebas locales y MySQL en modo de auditoria `standard`, sin escribir datos ni llamar a Siigo o BuilderBot.

| Precondicion | Estado comprobado |
|---|---|
| Producto maestro | Activo, ID interno `104`, SKU principal `00276-PTZNASHWA`, unidad `und` y modalidad `IO`. |
| Identificacion por nombre | Alias activos `zenova ashwagandha` y `zenova ashwa`. |
| Control por lote | Obligatorio. La recepcion debe registrar el lote y vencimiento informados por el proveedor. |
| Produccion interna | Bloqueada para modalidad `IO`; el producto no tiene filas de BOM. |
| Ubicacion preferida | `B13` en `BG-PPAL`. Es una sugerencia operativa, no una ubicacion exclusiva. |
| Stock existente | 24 und en `DEMO-MAPA-B13-00276-PTZNASHWA`, vencimiento `2027-12-31`, creadas por ajuste del mapa. No usar este lote como evidencia de recepcion desde un documento de proveedor. |
| Documento de entrada, recepcion y despacho IO | PDF demo y OC provisional `DEMO-20260902-DOC-IO-001` verificados en base de datos con 5 und. La preparacion por WhatsApp creo el borrador `REC-OC-6-001` en estado `borrador`, sin lote, ubicacion ni cantidad recibida todavia. La confirmacion fisica y el despacho siguen pendientes. |
| Roles actuales | Juan conserva `admin`; Datana esta en `recepcion_cierre`. No se modificaron roles durante el preflight. |
| Pruebas locales enfocadas | 37 de 37 aprobadas: modalidad, recepcion desde OC, confirmacion por WhatsApp, ubicaciones, despacho e idempotencia de referencias. No equivalen a un ensayo vivo del SKU IO. |

### Documento real aportado por el cliente

La fotografia recibida corresponde a la **Remision 106** de un proveedor, no a una orden de compra. Contiene cliente, ciudad, fecha, descripcion de producto, cantidad, lote y vencimiento. Los campos `Orden de pedido`, `N. de cajas`, responsable y recibe aparecen vacios, y no se observan SKU.

Los productos visibles son `COLAGENO HIDROLIZADO BIOTINA Y RESVERATROL` y `CHONTADURO BOROJO MACA SABOR ARTIFICIAL MARACUYA`; no corresponden al producto elegido para el demo, `00276-PTZNASHWA`. Ademas, esos textos no resuelven de forma inequivoca un producto `IO` activo del catalogo actual. Por seguridad no se deben mapear por aproximacion ni presentar esta fotografia como OC de Zenova.

Decision confirmada por el cliente durante el preflight: para producto in-and-out, el documento contra el que revisan el ingreso puede ser una **remision del proveedor o una factura del proveedor**. Ambos deben poder originar la recepcion esperada y conservarse como soporte; no se debe obligar al usuario a registrar ese documento como si fuera una OC.

El flujo desplegado actualmente inicia la recepcion directa desde una OC. Por tanto, el soporte `REMISION`/`FACTURA_PROVEEDOR` es un ajuste funcional pendiente y no debe presentarse en el demo como terminado. La remision real sirve para explicar los datos que deben extraerse y cotejarse: proveedor, numero de documento, fecha, producto, cantidad, lote y vencimiento.

Diseño recomendado para evitar dos flujos duplicados: crear un unico concepto de **documento de entrada de proveedor** con tipo `REMISION` o `FACTURA_PROVEEDOR`, identidad unica por proveedor, tipo y numero, archivo original, hash, fecha e items. Ambos tipos deben pasar por la misma revision humana y por el mismo motor transaccional de recepcion; una OC, cuando exista, se vincula como referencia opcional y no cambia la forma de contabilizar el ingreso fisico.

### Preparacion tecnica obligatoria antes de la reunion

Estado de preparacion al 2026-09-02:

1. **Completado:** PDF demo `DEMO-20260902-DOC-IO-001.pdf` creado con una linea de `00276-PTZNASHWA` por 5 und, lote `DEMO-IO-ZENOVA-001` y vencimiento `2027-11-30`.
2. **Completado con mecanismo provisional:** OC demo ID `6`, numero `DEMO-20260902-DOC-IO-001`, cargada con el PDF. WhatsApp preparo correctamente el borrador `REC-OC-6-001`; durante la reunion se debe declarar que la pantalla aun sera adaptada para aceptar remision o factura de proveedor sin disfrazarlas de OC.
3. Usar para la recepcion el lote `DEMO-IO-ZENOVA-001`, vencimiento `2027-11-30` y ubicacion `B13`. Ese vencimiento es anterior al lote del mapa y permite comprobar FEFO en el despacho.
4. Despues de recibir las 5 und, precargar una factura **sintetica** `FV-DEMO-IO-20260902-001` para el cliente de prueba `WMSQA260721 Cliente`, con 2 und de `00276-PTZNASHWA`.
5. La precarga debe invocar directamente el importador determinista `importInvoice()` con notificaciones externas desactivadas. No debe consultar, crear ni modificar documentos en Siigo. Debe producir una tarea `picking` con 2 und reservadas del lote recibido.
6. Guardar los ID cortos devueltos para el documento, recepcion y despacho. No predecir ni dictar los codigos largos durante la reunion.

No habilitar `ALLOW_DIRECT_DISPATCH_REQUEST`: el despacho directo esta desactivado intencionalmente. La demostracion debe confirmar una tarea con forma de factura importada, no abrir una salida manual paralela.

### Pasos exactos del demo

#### 1. Mostrar la modalidad

1. Abrir `Productos` y buscar `zenova ashwa` o `00276-PTZNASHWA`.
2. Mostrar modalidad `IO`, unidad `und`, control por lote y ausencia de BOM.
3. Explicar que el WMS no crea OP ni consume insumos para este recorrido.

#### 2. Recibir cinco unidades

1. Con Datana en rol `recepcion_cierre`, enviar por WhatsApp: `Que recepciones pendientes hay?`
2. Elegir el documento IO demo mediante su ID corto: `Prepara la recepcion ID <ID_DOCUMENTO_IO>`.
3. El agente debe mostrar 5 und pendientes de Zenova Ashwagandha, lote de proveedor requerido y ubicacion sugerida `B13`. Preparar no modifica inventario.
4. Enviar: `Para la recepcion ID <ID_DOCUMENTO_IO> llegaron completas 5 unidades de Zenova Ashwagandha, lote DEMO-IO-ZENOVA-001, vencen el 30 de noviembre de 2027 y estan disponibles en B13.`
5. El agente debe devolver una vista previa canonica con SKU, cantidad, condicion, ubicacion, lote y vencimiento, indicando que aun no modifico inventario.
6. Confirmar con la frase explicita solicitada: `Confirmo la recepcion ID <ID_DOCUMENTO_IO>`.
7. Repetir una vez la misma confirmacion para mostrar idempotencia. Debe informar que ya fue recibida y no volver a sumar inventario.

Mensajes esperados:

| Momento | Quien recibe | Contenido minimo esperado |
|---|---|---|
| Consulta | Datana | ID corto, tipo y numero de documento, proveedor, `00276-PTZNASHWA`, 5 und y lote requerido. |
| Preparacion | Datana | Borrador `REC-...`, saldo pendiente, lote requerido y sugerencia `B13`; sin cambio de inventario. |
| Vista previa | Datana | 5 und `DISPONIBLE`, lote `DEMO-IO-ZENOVA-001`, vencimiento `2027-11-30` y `B13`; solicitud de confirmacion explicita. |
| Confirmacion | Datana | Recepcion confirmada contra el documento; recibido 5, disponible 5, cuarentena 0 y rechazado 0. |
| Reintento | Datana | Ya recibida; no se modifico inventario. |

#### 3. Confirmar un despacho sin llamar a Siigo

1. Antes de este paso, comprobar en el dashboard que la factura sintetica creo una tarea de despacho en `picking` y reservo exactamente 2 und del lote `DEMO-IO-ZENOVA-001`.
2. Cambiar la linea rotativa a rol `despacho` siguiendo el procedimiento general del guion y volver a comprobar el rol efectivo.
3. Enviar por WhatsApp: `Que despachos pendientes hay?`
4. El agente debe listar la factura sintetica, cliente, producto, cantidad y el ID corto del despacho, sin modificar inventario.
5. Confirmar: `Confirma el despacho ID <ID_DESPACHO_IO>`.
6. El agente debe informar despacho, factura y salida de 2 und del lote `DEMO-IO-ZENOVA-001`.
7. Repetir la confirmacion. Debe indicar que ya estaba confirmado y no descontar otra vez.

Mensaje para el cliente: la factura mostrada es una simulacion local preparada para el demo; reproduce el contrato que importara Siigo, pero durante la reunion no se hace ninguna llamada al sistema contable.

#### 4. Cerrar con trazabilidad

1. Consultar por WhatsApp: `Muestrame la trazabilidad del lote DEMO-IO-ZENOVA-001`.
2. Mostrar el mismo lote en `Inventario > Buscar lote` y revisar el historico de recepciones y despachos.
3. Explicar que el resultado debe contener remision o factura de proveedor, proveedor, recepcion de 5 und, ubicacion `B13`, salida de 2 und, factura sintetica de venta, despacho, cliente final y saldo de 3 und.
4. Confirmar que no aparece orden de produccion, consumo de materias primas ni BOM.

### Validaciones que deben hacerse durante el ensayo

| Superficie | Antes del despacho | Despues del despacho |
|---|---|---|
| `stock` | Cantidad 5, reservada 2, disponible 3 en `B13`. | Cantidad 3, reservada 0, disponible 3. |
| `lots` | Inicial 5, actual 5, origen `RECEPCION`, estado `DISPONIBLE`. | Inicial 5, actual 3, estado `DISPONIBLE`. |
| `kardex` | Un `INGRESO_RECEPCION` de +5. | El ingreso anterior y un solo `DESPACHO` de -2. |
| Recepcion | Documento de proveedor vinculado, tipo, numero, proveedor, lote, vencimiento, ubicacion y 5 und aceptadas. | Sin cambios. |
| Despacho | Estado `picking`, factura sintetica, cliente y 2 und reservadas. | Estado `despachado`, 2 und despachadas y fecha registrada. |
| Produccion | Cero OP y cero consumo de materiales para el lote. | Debe continuar en cero. |

Estas cifras solo pueden marcarse como validadas despues del ensayo vivo. El lote `DEMO-MAPA-B13-00276-PTZNASHWA` debe permanecer separado y no debe aparecer como origen del despacho IO.

### Preguntas para el cliente

Pregunta principal para definir en este punto del demo:

> ¿Cual sera el documento que utilizara el equipo para apoyar cada recepcion y comparar lo esperado contra lo que llega fisicamente? Puede ser una remision, una factura del proveedor u otro soporte. Necesitamos definir sus caracteristicas minimas: proveedor, tipo y numero unico de documento, fecha, SKU o nombre aprobado del producto, unidad de medida, cantidad esperada, lote, vencimiento y, cuando aplique, numero de cajas. Tambien debemos confirmar si todos los proveedores usan el mismo formato, si aceptaran PDF y fotografia, y como se representaran entregas parciales, varios lotes o diferencias fisicas.

La respuesta debe permitir decidir si el WMS manejara un formato unico, varios formatos de proveedor con reglas de lectura, o una plantilla estandar que el cliente exigira o completara antes de recibir.

1. Si para una entrega tambien existe una OC, ¿quieren vincularla y comparar `OC vs remision/factura de proveedor vs recibido fisico`, o basta el documento de proveedor contra lo recibido?
2. La remision 106 no muestra SKU. ¿El proveedor puede incluir el SKU de Infinity o debemos mantener una tabla aprobada de nombres del proveedor por producto?
3. ¿El numero de remision o factura debe ser obligatorio y unico por proveedor para impedir que el mismo documento se reciba dos veces?
4. ¿Una remision o factura puede contener varios lotes del mismo producto o entregas parciales?
5. ¿Las cantidades del documento estan siempre en unidades individuales? Si tambien manejan cajas, ¿el numero de cajas es informativo o participa en la conciliacion?
6. ¿Quien decide cuarentena o rechazo cuando el lote, vencimiento, cantidad o estado fisico no coincide con el documento?
7. ¿La evidencia debe conservarse como PDF/fotografia descargable asociada a la recepcion?

### Bloqueadores confirmados

1. No existe todavia un documento de entrada, recepcion ni tarea de despacho para `00276-PTZNASHWA`; el recorrido no esta listo para ejecutarse sin preparacion.
2. La remision 106 no corresponde al SKU elegido y no contiene SKU visibles. No puede utilizarse como fixture de Zenova ni mapearse automaticamente con seguridad.
3. El WMS actual inicia la recepcion directa desde una OC. Todavia no admite una remision o factura de proveedor como origen documental de una recepcion IO, aunque esa es la regla operativa confirmada por el cliente.
4. El despacho directo esta desactivado y los despachos confirmables requieren una factura importada. Para el demo hace falta precargar la factura sintetica indicada; no existe actualmente.
5. La trazabilidad completa documento de proveedor -> recepcion -> lote -> factura de venta -> despacho -> cliente no puede demostrarse con el lote de ajuste del mapa.

Mensaje central para el cliente: el WMS no obliga a pasar por produccion un producto que solo entra, se almacena y se despacha; mantiene lote y vencimiento del proveedor, ubicacion interna y trazabilidad hasta el cliente final.

## Escenario 3: maquila tercerizada 3Q

Referencia: `00105-PTBOS60` - PRODUCTO TERMINADO BOOSTER X 60.

### 1. Preparacion

1. Mostrar la OC con PDF y la cantidad de producto terminado esperada.
2. Abrir `Maquila 3Q > Nueva orden`.
3. Crear una orden de 4 unidades vinculada con la OC.
4. Mostrar el BOM de etapa `ENVIO`: tapa, tarro, etiqueta y liner.
5. Destacar que el BOM de envio no contiene gomas y que el WMS no representa a 3Q como una bodega propia.

### 2. Salida a 3Q

1. Mostrar la remision en borrador con lotes FEFO y ubicaciones internas de origen.
2. Confirmar la salida mediante la segunda accion explicita.
3. Verificar el descuento del inventario interno y el cambio de estado a custodia de 3Q.
4. Repetir la confirmacion para demostrar idempotencia: no debe descontar nuevamente.

### 3. Recepcion parcial

1. Mostrar el documento de compra demo y vincularlo con la misma OC y orden 3Q.
2. Recibir 3 de las 4 unidades esperadas.
3. Registrar el lote y vencimiento definidos por 3Q y la ubicacion interna de destino.
4. Mostrar el estado `RECIBIDA_PARCIAL`; la orden y la OC permanecen abiertas.
5. Recibir la cuarta unidad o dejarla pendiente para explicar el acumulado.
6. Si llega una unidad no conforme, enviarla a cuarentena o rechazo; no debe cerrar el saldo disponible.

### 4. Material adicional

1. Preparar una remision adicional con material, cantidad y motivo.
2. Confirmar la salida separadamente.
3. Mostrar que el material adicional queda identificado para la conciliacion como merma de maquila.

### 5. Despacho

Una vez recibido y disponible, el producto tercerizado sigue el mismo flujo de venta demo precargada, reserva, tarea de despacho, confirmacion fisica y trazabilidad a cliente final.

## Cierre con trazabilidad

Finalizar consultando un lote de cada recorrido:

- `PR`: proveedor de insumos, recepcion, materiales consumidos, OP, mermas, lote terminado, factura y cliente.
- `IO`: proveedor, recepcion del producto terminado, lote, factura y cliente, sin OP intermedia.
- `PT`: OC, materiales enviados a 3Q, remisiones, recepciones parciales, lote definido por 3Q, factura y cliente.

## Controles que conviene demostrar

- Un producto `PT` o `IO` no puede liberarse como produccion interna.
- Cuarentena y rechazo no aumentan el inventario disponible.
- Una remision 3Q en borrador reserva, pero no descuenta.
- Una factura de venta no descuenta inventario hasta confirmar la salida fisica.
- Repetir una confirmacion no genera un segundo movimiento.
- Los permisos se validan en API, incluso si alguien intenta ejecutar la accion desde otro canal.
- Ninguna descripcion libre se utiliza para adivinar un SKU.

## Preparacion obligatoria antes del demo

Estado verificado el 2026-09-01:

- API desplegada y MySQL conectado.
- Prompt operativo sincronizado en los flujos de texto y voz de BuilderBot.
- Ruta desplegada de maquila 3Q disponible.
- Dashboard de maquila incluido en el build.
- Suite local: 147 de 147 pruebas aprobadas.
- Build de produccion aprobado.
- La OC demo `DEMO-WA-20260902-OC-001` fue creada y recibida; sus cinco items ingresaron de forma atomica.
- Las OP 63, 64, 65 y 66 estan `CANCELADA`, con reservas liberadas y sin movimientos de inventario.
- Juan (`3174442659`) tiene rol `admin`; la linea rotativa (`3125031367`) tiene actualmente rol `alistador`.
- La OP oficial del ensayo es ID 67 / `OP-20260902-000067`, esta `EN_PROCESO`; consumio una sola vez las reservas de sus cinco componentes y dejo seis movimientos de Kardex.
- Los escenarios `IO` y 3Q todavia requieren un ensayo final con los datos concretos que se mostraran.
- El plano `POSICIONES_bodega.pdf` se cargo como preferencias: 77 posiciones y 83 asignaciones activas para 48 productos. Adicionalmente, 12 posiciones contienen stock demostrativo auditable con lotes `DEMO-MAPA-*`.

Excepciones del plano que no bloquean el demo:

- `D7` no aparece y no se creo por inferencia.
- `D8` aparece dos veces; se conservo una sola posicion.
- `00276-PTZNASHWAB` se normalizo a `00276-PTZNASHWA`, la unica referencia maestra de Zenova Ashwagandha.
- Ocho referencias del plano no existen en el maestro vigente y ocho existen pero estan inactivas; no se asociaron automaticamente.

Antes de la sesion se debe:

1. Confirmar el saldo disponible para producir 3 unidades de `00102-PTASH60`. Verificado despues de cancelar las OP 63 y 64.
2. Cargar inventario demo identificable para los insumos de `00105-PTBOS60`.
3. Preparar una recepcion de cinco unidades de `00276-PTZNASHWA`.
4. Crear dentro del WMS las OC y los documentos simulados necesarios para los recorridos `IO` y 3Q.
5. Precargar las ventas y tareas de despacho demo sin invocar la API de Siigo.
6. Confirmar a Juan como `admin` y cambiar inicialmente la linea rotativa de `alistador` a `recepcion_cierre`.
7. Tomar una captura de saldos, lotes, reservas y estados iniciales.
8. Ejecutar un ensayo completo y guardar los identificadores generados en esta bitacora.
9. Dejar abiertas en el navegador las paginas necesarias y tener una ruta de contingencia con registros ya creados.
10. Verificar el cambio de rol `recepcion_cierre -> alistador -> recepcion_cierre -> despacho` y restaurar `recepcion_cierre` al terminar.

## Plan de contingencia

No depender durante la reunion de WhatsApp, un cron ni un servicio contable externo.

- Precargar directamente en el ambiente de desarrollo las compras y ventas simuladas que se usaran.
- Conservar una OP cerrada y una orden 3Q preparada como respaldo visual.
- Si una notificacion tarda, continuar desde la bandeja del dashboard y mostrar despues el historial de notificaciones.
- Mostrar como punto de integracion los identificadores externos simulados, aclarando que no provienen de la base real del cliente.
- No limpiar los datos demo hasta terminar la reunion y confirmar que no se necesita repetir el recorrido.

## Frase de cierre sugerida

El WMS controla lo que realmente ocurre en la bodega. La diferencia entre producir, tercerizar o simplemente recibir y despachar cambia el recorrido operativo, pero no rompe la trazabilidad del lote hasta el cliente final. La integracion contable se conectara y validara por separado.
