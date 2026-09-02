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
| Cerrar la OP del ensayo final | Pendiente de ensayo final | Debe crear lote PT, registrar merma, conciliar materiales y notificar a administracion. |
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
2. Registrar una merma de proceso con referencia, insumo, lote, ubicacion, cantidad y motivo.
3. Nelly cierra la OP con 2 unidades conformes y 1 de merma.
4. Mostrar la conciliacion entre BOM teorico, material entregado, devoluciones, merma y uso productivo.
5. Verificar la creacion del lote de producto terminado y su ubicacion.

Mensajeria esperada para el cierre:

| Momento | Quien envia | Quien recibe | Contenido esperado |
|---|---|---|---|
| Merma durante el proceso | Alistador | Alistador | Referencia de merma, insumo, cantidad, motivo y OP asociada; no debe descontar nuevamente el material ya consumido. |
| Cierre de produccion | Nelly/recepcion y cierre | Nelly/recepcion y cierre | Codigo OP, conformes, merma de producto terminado, lote PT, vencimiento y ubicacion. |
| Produccion terminada | Sistema | Sofi/administrador | Plan, conformes, merma y porcentaje, motivo, lote PT, ubicacion, vencimiento, quien cerro y conciliacion de materiales. |

Pregunta para el cliente durante el demo:

> ¿Una merma reportada durante la produccion debe avisarse inmediatamente a Sofi o Nelly, o es suficiente incluirla en la conciliacion enviada al cerrar la orden?

### 4. Despacho

1. Mostrar una venta demo precargada, sin realizar llamadas a Siigo.
2. Mostrar la tarea de despacho con cliente final, cantidades, lote FEFO y ubicacion.
3. Anderson confirma la salida fisica.
4. Verificar que el inventario se descuenta una sola vez y queda asociado a factura, despacho y cliente.

## Escenario 2: producto in-and-out

Referencia: `00276-PTZNASHWA` - PRODUCTO TERMINADO ZENOVA ASHWAGANDHA.

1. Mostrar que el producto esta clasificado como `IO` y no tiene BOM propio de produccion.
2. Cargar o mostrar la OC y el documento de compra demo correspondiente.
3. Confirmar directamente la recepcion del producto terminado, incluyendo lote del proveedor, vencimiento y ubicacion.
4. Verificar que no se crea OP, consumo de materia prima ni movimiento a produccion.
5. Mostrar una venta demo precargada y confirmar el despacho de 2 unidades.
6. Consultar el lote para mostrar proveedor, recepcion, saldo, factura, despacho y cliente final.

Mensaje para el cliente: el WMS no obliga a pasar por produccion un producto que solo entra, se almacena y se despacha.

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
