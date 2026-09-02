# Estado y bitácora del proyecto WMS

Última actualización: 2026-09-02

## Propósito

Este documento es la referencia ejecutiva y técnica del estado global del WMS. Se actualiza cuando cambia una capacidad, flujo operativo, integración, despliegue, migración, riesgo o decisión de producto.

No reemplaza:

- Git, que conserva el detalle exacto de cada cambio de código.
- `docs/builderbot-agent-map.md`, que define el contrato del agente.
- `docs/plan-pruebas-siigo.md`, que conserva evidencia detallada de Siigo.
- `docs/validacion-flujos-bodega-2026-08-04.md`, que documenta los smokes integrados.

## Resumen actual

### 2026-09-02 - Reposicion controlada de materiales en produccion

- Sofi puede preparar una reposicion para unidades conformes faltantes de una OP `EN_PROCESO`, indicando cantidad, motivo y confirmando expresamente el BOM completo.
- La preparacion usa el BOM congelado en la OP, reserva inventario por FEFO y notifica al Alistador; no descuenta existencias.
- El Alistador confirma la entrega adicional con el codigo de reposicion o el ID de la OP. Solo esa confirmacion descuenta los lotes reservados, actualiza la conciliacion y notifica a Sofi y Nelly.
- Sofi puede cancelar una reposicion pendiente y liberar reservas. Una reposicion confirmada no puede cancelarse y una OP con reposicion pendiente no puede cerrarse.
- Se incorporaron rutas de dashboard y handlers de WhatsApp separados por capacidad: `production.release` para preparar/cancelar y `production.pick` para confirmar.
- `produccion_materiales` y `produccion_material_lotes` se convirtieron de MyISAM a InnoDB despues de seis chequeos sin huerfanos, para que los flujos de produccion tengan rollback transaccional real.
- La politica automatica ante un cierre corto sigue pendiente de decision del cliente. El flujo de reposicion solo se ejecuta mediante autorizacion explicita.
- Validacion local: 163 pruebas aprobadas, build Vite aprobado y migracion verificada en la base de desarrollo.

### 2026-09-02 - Referencias automaticas para mermas por WhatsApp

- El operario ya no debe inventar una referencia para reportar una merma de proceso o bodega desde WhatsApp.
- BuilderBot envia producto, cantidad, motivo y contexto de orden o lote; el WMS genera una referencia `AUTO-MER-...` con fecha operativa de Bogota.
- Reintentos operativamente identicos se serializan y deduplican durante una ventana corta antes de cualquier descuento de inventario.
- Las referencias aportadas desde formatos o documentos reales siguen siendo aceptadas y conservadas exactamente.
- En mermas de proceso, nombres cortos como `goma` se resuelven solo contra los materiales y el producto de la OP; coincidencias multiples fallan cerrado y piden precision.
- El endpoint del dashboard mantiene obligatoria la referencia externa para no debilitar integraciones existentes.

### 2026-09-01 - Destino explicito al liberar produccion

- Una solicitud de produccion sin destino ya no puede convertirse implicitamente en stock de seguridad.
- El agente debe preguntar si la OP corresponde a stock de seguridad o a un pedido de cliente antes de emitir la accion operativa.
- El webhook valida el texto contractual `body/text/query` antes de crear la OP: omisiones, ambiguedades o contradicciones fallan cerrado sin crear orden ni reservar inventario.
- Para pedidos de cliente, la referencia y el cliente final deben estar explicitamente presentes en el mensaje actual. El agente no puede usar una frase generica como referencia ni convertir al remitente en cliente final.
- La OP QA 65, creada por una inferencia anterior del agente, se cancelo de forma controlada; se liberaron sus cinco reservas, sin movimientos ni cambios en cantidades fisicas, y se dejo registro de auditoria.
- Validacion local: 136 pruebas aprobadas y build Vite de produccion aprobado.

### 2026-09-01 - Confirmacion visible de cantidad planeada

- La respuesta al liberar una OP muestra explicitamente la cantidad interpretada y persistida, evitando que el usuario deba inferirla desde el BOM cuando la solicitud proviene de un audio.

### 2026-09-01 - Atomicidad de distribuciones de recepcion

- `recepcion_distribuciones` se migra de MyISAM a InnoDB para que sus filas obedezcan el mismo commit o rollback que lotes, stock, movimientos y kardex.
- Se restauran las cuatro claves foraneas declaradas por el esquema original y se bloquea la migracion si existen relaciones huerfanas.
- El esquema base declara explicitamente InnoDB para evitar que una instalacion herede el motor predeterminado del servidor.

### 2026-09-01 - Kardex multiitem en recepciones

- Cada asiento de kardex de una recepcion recibe su propio `tx_id`, respetando `uq_kardex_tx` cuando una OC contiene varios productos o distribuciones.
- Los asientos mantienen la misma referencia `recepcion:REC-...` y registran el identificador comun de operacion en notas para conservar agrupacion y auditoria.
- El error de clave duplicada revierte la transaccion completa; la recepcion demo permanecio en borrador sin lotes ni kardex parciales.

### 2026-09-01 - Borrador fisico persistente de recepcion

- La vista previa validada se guarda durante 24 horas en `recepcion_confirmacion_borradores`, asociada a OC, recepcion y usuario.
- La confirmacion final recupera exactamente el payload revisado; ya no depende del historial de BuilderBot ni permite que el LLM cambie items entre resumen y confirmacion.
- El payload guarda solo datos operacionales canonicos, incluye hash de integridad y queda marcado como consumido tras completar la recepcion.

### 2026-09-01 - Vista previa validada antes de confirmar recepcion

- Si el agente envia prematuramente la accion con datos fisicos pero sin confirmacion explicita en el texto, la API ya no devuelve un error generico.
- La API valida OC, borrador, productos, cantidades, condiciones, ubicaciones y lotes, y responde un resumen canonico sin modificar inventario.
- La confirmacion posterior sigue requiriendo intencion explicita e ID coincidente; el texto del usuario, no la bandera generada por el LLM, autoriza el movimiento.

### 2026-09-01 - Recepcion por ID sin dictar codigo REC

- El operario ya no necesita recordar o dictar el codigo tecnico `REC-...` para confirmar una recepcion.
- Con el ID corto de la OC, la API resuelve el unico borrador activo; si encuentra mas de uno, falla cerrado y solicita el codigo para desambiguar.
- La recepcion sigue exigiendo todos los datos fisicos, resumen previo y confirmacion explicita antes de modificar inventario.

### 2026-09-01 - Confirmacion natural y explicita de recepciones

- BuilderBot acepta variantes equivalentes como `Confirmo la recepcion de ID 5`, manteniendo obligatorio el tipo de operacion y el identificador correcto.
- Mensajes vagos como `confirmo`, `listo` o `proceda` siguen sin autorizar movimientos de inventario.
- El parser transaccional ya soportaba estas variantes; se alinearon las instrucciones del agente para evitar rechazos conversacionales innecesarios.

### 2026-09-01 - Lote de proveedor segun politica del producto

- La recepcion fisica ahora respeta `productos.requiere_lote` en API, dashboard y WhatsApp.
- Cuando el producto controla lote, el operario debe registrar exactamente el lote informado por el proveedor; el WMS no lo inventa.
- Para productos sin control obligatorio, el lote del proveedor puede registrarse si existe. Si se omite, el WMS genera una partida interna determinista `RECINT-...` para conservar FIFO, ubicacion, movimientos y trazabilidad.
- El vencimiento permanece opcional y solo se registra cuando el proveedor lo informa.
- Las partidas internas no cambian la cantidad recibida ni evitan los controles de condicion, ubicacion, diferencias, RBAC, transaccion e idempotencia.

### 2026-09-01 - Alias humanos e identificadores operativos cortos

- Se agrego `producto_aliases` como catalogo separado de los SKU externos. Cubre los 79 productos activos con nombre oficial y nombres comunes documentados; el SKU maestro no se modifica.
- El resolvedor usa coincidencia exacta normalizada, reconoce presentaciones dictadas como `sesenta`, `ciento veinte` y `ciento cuarenta`, y falla cerrado cuando un nombre identifica mas de un producto.
- Recepcion, produccion, consultas de stock y capacidad, mermas, devoluciones y maquila 3Q reutilizan el mismo resolvedor. En recepciones la busqueda se limita a los productos realmente pendientes de la OC.
- Las respuestas muestran nombre y SKU. Las OC, recepciones, OP y despachos pueden seleccionarse mediante IDs numericos cortos previamente listados.
- Confirmar una OC o recepcion sigue exigiendo una frase explicita; el ID corto debe coincidir con la entidad elegida. Reintentos e IDs distintos no mutan inventario.
- `CONSULTAR_ESTADO_PRODUCCION` sin ID lista OP activas y `CONSULTAR_DESPACHOS_PENDIENTES` lista tareas originadas en factura Siigo, ambas sin modificar inventario.
- Migracion `22_product_aliases.sql` aplicada en QA: 139 alias activos para 79 productos y cero colisiones entre productos.
- Validacion local: 122 pruebas aprobadas, build Vite de produccion aprobado y revision `standard` de seguridad sin hallazgos bloqueantes en este cambio.

### 2026-09-01 - Seleccion corta de recepciones por WhatsApp

- `CONSULTAR_RECEPCIONES_PENDIENTES` lista hasta diez OC aptas para recepcion directa y con saldo fisico real, sin preparar recepciones ni modificar inventario.
- Cada opcion conserva el numero documental completo y agrega el ID numerico estable de la OC. El usuario puede decir `prepara la recepcion ID 5`, evitando dictar por audio referencias largas.
- La consulta excluye OC de produccion interna (`PR`), maquila 3Q (`PT`), unidades incompatibles y ordenes totalmente recibidas.
- La seleccion no depende de posiciones variables como `la primera`; `PREPARAR_RECEPCION_OC` recibe el `orden_compra_id` exacto devuelto por la API.
- El handler requiere solo permiso de lectura de recepciones. Las confirmaciones destructivas conservan sus controles actuales.
- Validacion local: 115 pruebas aprobadas y build Vite de produccion aprobado.

### 2026-09-01 - Orden de compra y recepcion fisica operables por WhatsApp

- El canal WhatsApp puede revisar un borrador de OC, crear la OC operativa, preparar su recepcion fisica y confirmar la entrada sin depender del dashboard.
- El PDF conserva su rol de evidencia: solo crea un borrador. Una OC con advertencias, proveedor ambiguo o SKU desconocido debe corregirse desde el dashboard.
- Crear la OC exige la frase exacta con el numero documental o ID corto; confirmar inventario exige `Confirmo la recepcion NUMERO-OC` o `Confirmo la recepcion ID N` en el mensaje actual.
- La confirmacion exige todos los SKU pendientes y distribuciones por cantidad, lote, vencimiento, condicion y ubicacion. Faltantes, sobrantes y condiciones bloqueadas requieren motivo.
- Dashboard y WhatsApp ejecutan las mismas funciones transaccionales de creacion y recepcion. `INGRESO_RECEPCION` queda bloqueado mientras `ALLOW_MANUAL_RECEPTION=false`.
- La migracion `21_reception_confirmation_idempotency.sql` agrega una identidad unica a cada confirmacion WhatsApp. Cada entrega parcial usa el borrador `REC-...` generado por el WMS; un reintento no puede convertirse en una entrega nueva ni ingresar inventario dos veces.
- Los logs del nuevo flujo conservan accion, referencia, cantidad de items y presencia de confirmacion, sin guardar el detalle de lotes o ubicaciones recibido en el JSON.
- Validacion local: 114 pruebas aprobadas; migracion aplicada y verificada en QA.

### 2026-09-01 - Recepcion fisica iniciada directamente desde la OC

- Las compras normales ya no dependen de una factura o recepcion importada desde Siigo.
- Nelly selecciona una OC abierta y el WMS prepara de forma idempotente una recepcion con el saldo pendiente por SKU y unidad.
- La preparacion no crea lotes, stock, movimientos ni kardex. El inventario cambia unicamente al aprobar la recepcion fisica.
- La confirmacion conserva distribuciones `DISPONIBLE`, `CUARENTENA`, `RECHAZADO` y `PENDIENTE_DISPOSICION`, con lote, vencimiento, ubicacion y motivo obligatorio para diferencias.
- Las recepciones parciales dejan la OC en `RECIBIDA_PARCIAL`; solo las cantidades disponibles reducen el saldo y una OC completamente atendida pasa a `CERRADA`.
- Los productos `PR` deben ingresar por produccion interna y los `PT` por orden de maquila 3Q. La recepcion directa admite materias primas, insumos y productos `IO`.
- Las cantidades mixtas se presentan agrupadas por unidad, por ejemplo `46 und + 2000 gr`, sin producir un total aritmetico enganoso.
- La migracion `20_direct_purchase_order_receptions.sql` se aplico y verifico en QA. La recepcion sintetica usada para simular una compra Siigo se elimino sin afectar inventario.
- Validacion local inicial: 110 pruebas aprobadas, build Vite de produccion aprobado y preparacion real repetida sin duplicados ni movimientos.

### 2026-09-01 - Ordenes de compra leidas desde WhatsApp

- El flujo `Documentos de Bodega` distingue `ORDEN_COMPRA` de `SALIDA_BODEGA_3Q` y mantiene el JSON interno oculto.
- Una OC recibida por PDF crea un borrador idempotente; no habilita recepciones, no reserva y no modifica inventario.
- La API valida referencia, fecha, proveedor, SKU y cantidades contra el texto documental, descarga el PDF solo desde dominios permitidos de BuilderBot, limita su tamano y verifica la firma `%PDF-`.
- `Recepciones > Ordenes de compra` muestra los borradores y exige revision de proveedor sincronizado, SKU, cantidades y unidades antes de convertirlos en una OC operativa.
- La conversion conserva PDF, hash, datos extraidos, correcciones humanas, actor y fecha. El numero revisado no puede diferir de la referencia visible del PDF.
- La accion `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO` requiere `reception.create`; los logs omiten texto OCR, URL firmada y detalle de items.
- Validacion local: PDF leido por WhatsApp, borrador creado una sola vez, revision humana y conversion a OC operativa aprobadas sin modificar inventario.

### 2026-09-01 - Cancelacion auditable de ordenes de compra

- Se habilito la cancelacion logica de OC desde el dashboard solo para usuarios con `purchase_order.cancel`.
- Solo una OC en estado `CARGADA` puede cancelarse; cualquier recepcion o proceso 3Q asociado bloquea la operacion.
- El motivo y una confirmacion explicita son obligatorios. MySQL conserva actor, fecha, motivo, PDF e items originales.
- La transicion usa bloqueo de fila, transaccion e idempotencia; repetir una cancelacion no altera el primer registro ni genera una segunda mutacion.
- La migracion `18_purchase_order_cancellation.sql` se aplico y verifico en la base QA sin modificar inventario.
- Validacion local: 95 pruebas aprobadas y build Vite de produccion aprobado.

### 2026-08-31 - Lectura documental de salidas hacia 3Q

- Se definio un flujo documental dedicado para leer PDF de `SALIDA DE BODEGA` y registrar un borrador estructurado en el WMS.
- El contrato incluye referencia, fecha, destinatario, datos de contacto, entrega/recibe, bultos, unidades y lineas con SKU, descripcion, cantidad, vencimiento y lote.
- La coincidencia de producto usa exclusivamente el SKU exacto. Totales diferentes, campos faltantes o codigos desconocidos quedan marcados para correccion.
- La ingestion es idempotente y restringida a `outsourcing.manage`; los logs omiten direccion, NIT, telefono y detalle de items.
- Los reintentos comparan una identidad operativa canonica: referencia, fecha, bultos, total, SKU y cantidad. Metadatos variables del OCR, lotes/vencimientos documentales, nombres o descripciones no generan falsos conflictos ni sobrescriben el primer borrador.
- La API exige evidencia literal para referencias y SKU extraidos por BuilderBot. Un lote o vencimiento inventado se convierte en dato pendiente con advertencia; el lote operativo de la remision sigue proviniendo del FEFO del WMS.
- El flujo documental de BuilderBot enruta el JSON interno mediante la regla `body includes g0m@s`; se retiro el `gotoFlow` directo que lo hacia visible por WhatsApp antes de la respuesta del WMS.
- El dashboard de Maquila 3Q incorpora la vista `Documentos leidos` con cruce al catalogo y remision WMS.
- La lectura nunca reserva ni descuenta inventario. Sofi conserva la confirmacion humana de la remision como unica accion de salida.
- Se agrego un PDF sintetico, claramente marcado como prueba, para validar el flujo sin datos reales del cliente.

### 2026-08-30 - OC en PDF y flujo de maquila 3Q

- La orden de compra exige PDF validado por firma, tipo, tamano y SHA-256, ademas de items estructurados para conciliacion.
- Las nuevas OC exigen seleccionar un proveedor activo sincronizado desde Siigo; se elimino el nombre libre para cerrar el cruce contable por identidad.
- Los documentos se almacenan fuera de los listados y se descargan mediante una ruta autenticada con cabeceras de descarga segura.
- Se creo el flujo de maquila `PT`: OC -> reserva FEFO -> remision en borrador -> confirmacion de salida -> custodia externa 3Q -> recepcion Siigo parcial -> conciliacion.
- 3Q no se modela como bodega ni ubicacion. Se conserva lote y ubicacion interna de origen y un saldo de custodia por SKU y unidad.
- Sofi administra ordenes, remisiones iniciales y material adicional. Nelly vincula cada linea `PT` recibida con su orden 3Q.
- Remisiones confirmadas son idempotentes; remisiones en borrador pueden cancelarse y liberan reservas en una transaccion.
- La OC acumula facturas y recepciones parciales. Solo la cantidad `DISPONIBLE` reduce el saldo pendiente; cuarentena y rechazo no cierran la orden.
- El material adicional confirmado se separa para conciliacion como merma de maquila.
- Validacion local: 78 pruebas aprobadas, build Vite de produccion aprobado y cero vulnerabilidades npm en dependencias de produccion.
- Se actualizaron `react-router-dom`, `postcss` y `nanoid` a revisiones corregidas. Queda pendiente migrar Vite 5 a Vite 8 para retirar la alerta del servidor de desarrollo; el servidor actual conserva el enlace local por defecto y no afecta el bundle desplegado.
- La migracion se aplico en QA: siete tablas 3Q creadas, cuatro columnas acumuladas agregadas y tres tablas heredadas convertidas de MyISAM a InnoDB, sin filas huerfanas.
- Estado operativo: codigo local y esquema QA terminados; despliegue, inventario de prueba, prueba funcional y handlers de WhatsApp pendientes.
- Contrato detallado: `docs/flujo-orden-compra-y-maquila-3q.md`.

### 2026-08-26 - Datos maestros y BOM desde el acta 5.2

- La sección 5.2 del acta de Infinity Brands se estableció como fuente canónica de productos terminados, modalidades y relaciones de materiales.
- Se cargaron 30 productos terminados: 21 de producción interna (`PR`), 3 de maquila tercerizada (`PT`) y 6 in-and-out (`IO`).
- La carga abarca 75 códigos entre productos terminados e insumos y 113 relaciones BOM: 101 de `PRODUCCION` y 12 de `ENVIO`.
- Las seis filas autorreferenciadas `IO` se usan para clasificación y no se cargan como BOM.
- Tres pares producto-insumo repetidos se normalizaron a una sola relación sin sumar cantidades; la evidencia conserva las filas de origen.
- MySQL incorpora `productos.modalidad_operativa` y `bom.etapa`, con barreras que impiden crear producción interna para productos `PT`, `IO` o sin modalidad.
- Se generaron respaldos `backup_productos_pre_acta_20260826`, `backup_skus_pre_acta_20260826` y `backup_bom_pre_acta_20260826` antes de reemplazar los datos maestros afectados.
- Se eliminaron 43 alias SKU heredados en dos pasadas; el catálogo visible quedó en 79 filas activas: 75 referencias de la sección 5.2 y cuatro cajas vigentes ya existentes.
- Los productos ajenos al conjunto vigente del acta quedaron inactivos para preservar sus relaciones históricas sin exponer referencias obsoletas; no quedó ningún SKU ligado a un producto inactivo.
- El importador reserva además los cinco códigos de embalaje restantes del acta para que no sean desactivados cuando se creen con la funcionalidad de empaque.
- Regla de maquila confirmada: 3Q recibe los materiales de envase del BOM, que pueden compartir SKU con producción interna, pero no recibe gomas. Las entregas adicionales se conciliarán como merma de la orden de maquila y queda pendiente vincular la identidad exacta de 3Q con Siigo.
- Cajas master confirmadas, sin sustitución por tener diseños diferentes: Calm Vibes usa `00041-CMCV`; CreaGums de 120 y 140 usa `00042-CMCG`; Vinagre usa `00040-CMV`.
- El importador es reproducible, usa bloqueo nominal, transacción, validación previa, verificación posterior y `dry-run` por defecto.
- Validación: 68 pruebas aprobadas; 75/75 códigos fuente activos y con SKU principal; cero SKU de productos inactivos, BOM `IO`, duplicados o cruces incompatibles de modalidad/etapa.
- Esta carga no sustituye el inventario inicial ni las ubicaciones definitivas. Los movimientos e inventario QA deberán depurarse antes del corte productivo.

### 2026-08-05 - Limpieza conservadora previa a demostracion

- Se agrego un procedimiento transaccional con modo simulacion para expirar solicitudes QA heredadas.
- Solo se elimina una merma QA anomala si no tiene movimiento ni kardex asociado.
- Productos, BOM, fixtures de inventario y operaciones QA trazables se preservan.
- Se expiraron veinte solicitudes heredadas de julio, se elimino la merma fallida de 99 unidades y se revirtio el despacho QA accidental `DSP-1785941723310`.
- El lote `TEST_AGENT-PTASH-DISP` se restauro a 87.75 unidades en stock y maestro de lote.

### 2026-08-05 - Detalle operativo en aprobaciones heredadas

- Las solicitudes antiguas con `qty`, `lpn`, `customer` y `product_id` se normalizan al contrato visual vigente.
- Las tarjetas muestran producto, SKU, cantidad, lote y cliente antes de gestionar una aprobacion.

### 2026-08-05 - Lote terminado visible en produccion

- El listado de produccion expone y muestra el LPN de producto terminado generado al cierre.
- El LPN se obtiene desde la relacion `lots.production_order_id`; no es una columna de `ordenes_produccion`.
- Las ordenes abiertas conservan `-` hasta que exista un lote PT.

### 2026-08-05 - Contrato de referencia de mermas del dashboard

- El servicio compartido acepta `external_reference`, que es el campo enviado por el formulario de mermas.
- Se agrego una prueba de regresion con el payload exacto de una merma de bodega desde React.

### 2026-08-05 - Disponibilidad operativa consistente en el dashboard

- Buscar producto separa inventario fisico, reservado, disponible operativo y bloqueado.
- Stock sin ubicacion activa, sin maestro de lote, vencido o con estado no disponible conserva trazabilidad, pero no suma como disponible.
- Los lotes totalmente reservados permanecen visibles en el detalle.
- Validacion: 51 pruebas unitarias, build Vite, 20 endpoints del dashboard y auditoria MySQL aprobados.

### 2026-08-05 - Capacidad de fabricacion basada en inventario elegible

- La capacidad por BOM excluye lotes no disponibles o vencidos y stock en ubicaciones inactivas.
- El saldo usado coincide con las reglas FEFO de liberacion de produccion y descuenta reservas vigentes.
- Se comprobo en MySQL que `00102-PTASH60` tiene una capacidad actual de 154 unidades, limitada por `00017-ETASH60`.
- Validacion: 47 pruebas unitarias y build Vite aprobados.

### 2026-08-05 - Trazabilidad de produccion con mermas diferenciadas

- La consulta del lote PT muestra la OP, plan, conformes, responsable y fecha de cierre.
- Las mermas de materia prima durante proceso se separan de la merma de producto terminado al cierre.
- El consumo de materiales muestra neto entregado, merma de proceso y uso productivo estimado.
- El auditor E2E ya no suma cantidades de SKU y unidades de medida diferentes como una sola merma.
- Validacion: 44 pruebas unitarias y auditoria integral de MySQL sin fallos.

### 2026-08-04 - Mermas transaccionales e idempotentes

- Dashboard y WhatsApp usan un unico servicio de mermas con el mismo contrato y las mismas validaciones.
- Toda merma exige una referencia externa unica, SKU, cantidad positiva y motivo.
- La merma de bodega exige lote y ubicacion activa exactos; descuenta solo stock no reservado.
- `mermas`, `stock`, `lots`, `movimientos` y `kardex` se actualizan en una sola transaccion.
- Un reintento identico no repite el descuento y reutilizar la referencia con datos diferentes se rechaza.
- La merma de una OP `EN_PROCESO` queda registrada para conciliacion sin volver a descontar stock disponible.
- El cierre separa material neto entregado, merma de proceso y uso productivo estimado para no ocultar perdidas de WIP.
- Migracion `15_waste_integrity.sql` aplicada en MySQL.
- Validacion: 41 pruebas unitarias, build Vite y smoke vivo con ubicacion incorrecta, exceso, reserva e idempotencia aprobados.

### 2026-08-04 - Devoluciones vinculadas al despacho original

- WhatsApp y dashboard usan un unico servicio transaccional de devoluciones.
- Cada devolucion nueva exige factura o despacho, referencia externa unica, SKU y lote original.
- El acumulado devuelto no puede superar lo despachado para la partida y el cliente debe coincidir.
- Cuarentena y destruccion se ubican en `CUAR-C-1-01` sin aumentar disponible.
- Solo `RECUPERABLE` crea stock en una ubicacion activa y conserva el vencimiento del lote original.
- `devoluciones` migro de MyISAM a InnoDB y ahora conserva relaciones con despacho, partida y ubicacion.

### 2026-08-04 - Ubicacion obligatoria en alistamiento de despachos

- FEFO solo reserva stock con ubicacion activa perteneciente a la misma bodega.
- La notificacion de tarea de despacho incluye SKU, cantidad, lote y codigo de ubicacion.
- Stock sin ubicacion permanece bloqueado hasta corregir el dato maestro.

### 2026-08-04 - Auditoria completa de entradas por recepcion

- `movimientos.referencia_tipo` admite la referencia completa `recepcion_siigo_import` sin truncamiento.
- Recepciones distribuidas y simples crean kardex de ingreso dentro de la misma transaccion.
- Las novedades de cuarentena y rechazo conservan el motivo especifico diligenciado.
- La migracion reparadora agrega kardex faltante sin modificar stock ni cantidades de lotes.

### 2026-08-04 - Cuarentena como ubicacion de la bodega principal

- `CUAR-C-1-01` se modela como ubicacion controlada dentro de `BG-PPAL` para nuevas recepciones.
- La ubicacion historica en la bodega logica de cuarentena se desactiva sin reescribir stock ni movimientos anteriores.
- El preflight bloquea nuevas pruebas si recepcion disponible y cuarentena no pertenecen a la bodega principal.

### 2026-08-04 - Resultado limpio en importacion dirigida de compras

- Una factura creada e importada en la misma ejecucion ya no reaparece como `duplicate` durante la reconciliacion de pendientes.
- La idempotencia de base de datos se conserva y los contadores reflejan una sola operacion logica.

### 2026-08-04 - Zona horaria consistente entre MySQL y Vercel

- La conexion MySQL interpreta `DATETIME` con `DB_TIMEZONE=-05:00` por defecto.
- Se evita que Vercel reste cinco horas adicionales al mostrar cierres ya procesados.
- El valor puede sobrescribirse por ambiente sin cambiar codigo.

### 2026-08-04 - Avisos de inicio y cierre de produccion

- `production_started:{op_id}` notifica a `admin` y `recepcion_cierre` con materiales, lotes y ubicaciones.
- `production_closed:{op_id}` notifica a `admin` con plan, resultado, merma, lote PT y conciliacion BOM.
- El actor se excluye de su propio aviso proactivo y una falla de WhatsApp no revierte la operacion.
- La ausencia de destinatarios queda registrada en `system_logs`.

### 2026-08-04 - Politica de notificaciones operativas

- Se creo `docs/politica-notificaciones-operativas.md` como fuente de verdad para eventos, destinatarios, fallbacks, contenido, idempotencia y decisiones configurables.
- Se separaron explicitamente autorizacion, tarea en dashboard y aviso por WhatsApp.
- La matriz distingue capacidades activas, siguientes, condicionales y eventos solo de dashboard.

### 2026-08-04 - Cierre de produccion con metadatos completos

- El parser separa motivo de merma, ubicacion y fecha de vencimiento en una sola frase.
- El cierre acepta alias del LLM para vencimiento, valida la fecha y la guarda en lote y stock.
- Las respuestas de cierre y ajustes de materiales muestran el codigo visible de ubicacion, no el ID interno.
- El reintento de un cierre informa responsable y fecha/hora sin repetir movimientos.
- Se corrigieron de forma auditada los metadatos QA de `OP-20260804-000060` sin modificar cantidades.
- Prompt sincronizado por MCP en Entrada y Voz; hash verificado `f3888f9f...f501f90`.
- Validacion local: 17 pruebas aprobadas.

### 2026-08-04 - Notificaciones salientes habilitadas por defecto

- Se restauro el comportamiento historico de mensajeria proactiva sin exigir `ENABLE_WORKFLOW_NOTIFICATIONS`.
- `DISABLE_OUTBOUND_NOTIFICATIONS=true` se conserva como corte de emergencia para envios y reintentos.
- Se mantuvieron la seleccion de destinatarios por rol, la deduplicacion por evento y destinatario, y la bitacora en `notificaciones_salida`.
- Validacion local: 15 pruebas aprobadas y build Vite aprobado.

### 2026-08-04 - Preparacion de pruebas E2E por rol

- Se creo `docs/plan-pruebas-e2e-wms.md` con el recorrido completo WhatsApp, API, MySQL, dashboard y Siigo sandbox.
- Se agrego `scripts/qa/e2e-preflight.js`, verificador de solo lectura para lineas, roles, ubicaciones, BOM, FEFO, stock e invariantes.
- Se confirmo que las dos lineas humanas estan activas y que la linea del agente no pertenece a un usuario operativo.
- Se corrigio el endpoint directo de despacho para respetar `ALLOW_DIRECT_DISPATCH_REQUEST=false` y exigir una tarea originada en factura Siigo.
- Validacion local: 13 pruebas aprobadas, build Vite aprobado y preflight MySQL sin bloqueos.
- Desplegado en `8042f45`: 20/20 rutas del dashboard y webhook operativo revalidados en Vercel.

| Área | Estado | Fuente de verdad |
| --- | --- | --- |
| Dashboard React | Desplegado y operativo | `frontend/src`, Vercel |
| API principal | Serverless activa | `api/v1`, Vercel |
| Backend Express | Histórico, no es producción | `backend/src` |
| MySQL | Conectado y con migraciones 07-10 aplicadas | `api/_lib/db.js`, `database` |
| Agente WhatsApp | Texto y voz configurados en BBC | `docs/Prompt WMS.txt`, BBC |
| Producción | Camino completo validado | Servicios `production-*` y smoke QA |
| Recepción | OC, factura, conciliación y distribución validadas | Servicios de recepción y smoke QA |
| Despacho | Factura Siigo, reserva y confirmación validadas | `dispatch-workflow.js` y smoke QA |
| Siigo | Sandbox validado; polling de compras y ventas programado en Vercel | `api/_lib/siigo.*`, crons Vercel |
| Notificaciones WhatsApp | Implementadas e idempotentes; activación controlada | `builderbot-notifications.js` |
| Roles nuevos | Implementados; asignación real pendiente | `capabilities.js`, dashboard Usuarios |
| Seguridad | Auditoría aplicada; quedan riesgos residuales documentados | Validación del 2026-08-04 |

## Estado desplegado comprobado

Comprobación del 2026-08-04:

- URL: `https://wms-seven-ebon.vercel.app`.
- `GET /api/v1/health`: HTTP 200 y `status=ok`.
- MySQL: conectado.
- Tablas críticas verificadas: `lots`, `kardex`, `stock`, `productos`, `recepciones`, `despachos`, `mermas`, `aprobaciones`, `ordenes_produccion` y `bom`.
- Rama principal: `main`.
- Repositorio: `https://github.com/royandi200/WMS`.
- Último commit funcional versionado: `21a0dfc`.

La salud HTTP no sustituye una prueba funcional por rol. El siguiente control pendiente es ejecutar el recorrido WhatsApp/dashboard con los números temporales asignados a Sofi, Nelly, Alistador y Anderson.

## Arquitectura vigente

```text
Dashboard React/Vite -----> API serverless Vercel -----> MySQL
       |                           |                       |
       |                           +-----> Siigo API       |
       |                           +-----> BuilderBot API --+--> WhatsApp
       |                                                   |
WhatsApp -> BuilderBot + LLM -> webhook WMS ---------------+
```

Reglas arquitectónicas:

1. `api/v1` es el backend de producción.
2. Dashboard y WhatsApp deben reutilizar los mismos servicios de dominio de `api/_lib`.
3. El rol se vuelve a consultar en MySQL; no se confía en el JSON del LLM.
4. Las mutaciones críticas usan transacciones, bloqueos e idempotencia.
5. Siigo origina los documentos contables; el WMS controla ejecución física, reservas, lotes y trazabilidad.

## Capacidades operativas actuales

### Recepción

- Carga estructurada de órdenes de compra de proveedor desde dashboard.
- Importación de factura de compra Siigo como recepción pendiente.
- Conciliación OC versus factura versus conteo físico.
- Distribución por lote, ubicación, vencimiento y condición.
- Condiciones: `DISPONIBLE`, `CUARENTENA`, `RECHAZADO` y `PENDIENTE_DISPOSICION`.
- Solo `DISPONIBLE` suma stock utilizable.
- Nelly puede confirmar su propia recepción.
- Recepciones manuales libres están desactivadas por defecto.

### Producción

- Sofi/Admin libera OP para `OC_CLIENTE` o `STOCK_SEGURIDAD`.
- Reserva de BOM por FEFO, lote y ubicación.
- Exclusión de lotes vencidos, no disponibles o en ubicaciones inactivas.
- Alistador confirma materiales e inicia producción.
- Registro de entrega adicional y devolución de materia prima con lote y ubicación.
- Nelly cierra la OP con conformes, merma, motivo y ubicación de producto terminado.
- Conciliación entre consumo teórico y real.
- Repetir confirmación o cierre no duplica movimientos.
- División de línea permanece implementable pero desactivada.

### Ventas y despacho

- La factura de venta se crea primero en Siigo.
- El polling importa la factura, el cliente final y sus líneas.
- El WMS crea una tarea y reserva stock por FEFO.
- Anderson confirma la salida física.
- El inventario se descuenta únicamente al confirmar el despacho.
- La trazabilidad enlaza lote, factura y cliente final.
- Despachos libres sin factura y despachos parciales están desactivados.

### Inventario y calidad

- Stock por SKU, lote, bodega y ubicación.
- Búsqueda profesional de producto con detalle de lotes.
- Consulta de lote y trazabilidad extendida.
- Stock bajo, resumen, kardex y mapa de bodega.
- Mermas durante proceso y cierre de producción.
- Devoluciones desde dashboard e historial.
- Cuarentena, rechazo y destrucción no regresan automáticamente a disponible.

### Usuarios y permisos

Roles objetivo:

| Rol | Responsable inicial | Alcance |
| --- | --- | --- |
| `admin` | Sofi | Administración y coordinación de producción |
| `recepcion_cierre` | Nelly | Recepción, clasificación, ubicación y cierre de producción |
| `alistador` | Por asignar | BOM, FEFO, picking, inicio y materiales de producción |
| `despacho` | Anderson | Tareas Siigo y confirmación de salida |
| `consulta` | Opcional | Lectura sin mutaciones |

Los permisos se centralizan en `api/_lib/capabilities.js`. El dashboard permite asignar roles existentes; el editor de permisos arbitrarios se pospuso intencionalmente.

Los roles heredados `supervisor`, `operario` y `validador` siguen disponibles por compatibilidad y deben retirarse gradualmente.

## Integraciones

### BuilderBot Cloud

- Proyecto: `Bodega Inventarios`.
- Project ID: `5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d`.
- Entrada de texto: prompt remoto sincronizado con `docs/Prompt WMS.txt`.
- Entrada de voz: clasificador creado el 2026-08-04 con el mismo prompt.
- Ambos flujos entregan JSON con `kw=g0m@s` al flujo `Salida`.
- Salida llama `POST /api/v1/webhook/builderbot` y mapea `{mensaje}`.
- SHA-256 del prompt sincronizado el 2026-08-04: `f63681366699d8aefe3c4cfa1476d48e8432453758960247e3488425f4cb9c2c`.

El validador BBC marca `Entrada` como dead end por una limitación legacy de conteo. La API Manager confirma que la respuesta existe y está activa.

### Siigo

- Autenticación con usuario API y access key; token cacheado en `siigo_config`.
- Catálogo y terceros sincronizables.
- Compras y ventas importadas mediante polling incremental.
- Crons de Vercel cada dos minutos, alternados para compras y ventas.
- Webhooks implementados, pero su suscripción debe manejarse con cautela en el sandbox compartido.
- Las pruebas confirmaron documentos de compra y venta visibles en Siigo Nube.
- Cotizaciones con validación de stock fueron probadas, pero no son el flujo comercial principal acordado.
- La API de Siigo probada no expuso un flujo utilizable de órdenes de compra; queda pendiente de definición con el cliente.

### MySQL

- Fuente de verdad operativa del WMS.
- Acceso de aplicación mediante `mysql2/promise`.
- Conexión serverless reutilizable para consultas y conexión dedicada para transacciones.
- MCP local de solo lectura disponible para diagnóstico asistido.
- Migraciones 07-10 agregan roles, flujos de bodega, notificaciones y conciliación de recepción.

### SysCafé

Existe una integración en el backend Express histórico. No está expuesta por la API serverless vigente ni forma parte del flujo productivo actual. No debe presentarse como integración activa.

## Banderas operativas

Valores seguros recomendados mientras se completan las pruebas:

```text
ALLOW_PARTIAL_DISPATCH=false
ENABLE_BACKORDER_ALERTS=false
AUTO_RELEASE_STALE_RESERVATIONS=false
RESERVE_AVAILABLE_ON_SHORTAGE=true
REQUIRE_PURCHASE_ORDER_FOR_SIIGO_RECEIPT=true
ALLOW_SPLIT_PRODUCTION_LINE=false
ALLOW_DIRECT_DISPATCH_REQUEST=false
ALLOW_MANUAL_RECEPTION=false
ENABLE_WORKFLOW_NOTIFICATIONS=false
```

Las notificaciones solo deben habilitarse después de asignar y comprobar los teléfonos de los cuatro roles.

## Validación acumulada

- `npm test`: 99 subpruebas aprobadas en la entrega del 2026-09-01.
- `npm run build`: build de producción aprobado en la última entrega funcional.
- Smokes integrados de producción, recepción y despacho aprobados.
- Idempotencia comprobada en cierre de OP, recepción y despacho.
- FEFO corregido para excluir vencidos.
- Cuarentena y rechazo comprobados sin stock disponible.
- Descuento de despacho comprobado una sola vez.
- Auditoría `wms-security-audit` ejecutada sobre la entrega del 2026-08-04.

## Riesgos y pendientes prioritarios

1. Configurar `X-BuilderBot-Secret` en BBC y retirar el fallback de autenticación por `kw` antes de usar datos productivos.
2. Asignar los usuarios reales o temporales a los cuatro roles y ejecutar pruebas WhatsApp por etapas.
3. Mantener desactivadas las notificaciones hasta validar destinatarios y evitar duplicados.
4. Definir múltiples facturas o recepciones parciales contra una misma OC.
5. Completar el ciclo de reservas para despachos parciales antes de habilitarlo.
6. Instalar o verificar la CA de MySQL; la opción TLS actual puede usar `rejectUnauthorized=false`.
7. Confirmar con el cliente el uso real de órdenes de compra en Siigo.
8. Cargar ubicaciones e inventario inicial definitivos y depurar movimientos, lotes y stock QA antes de producción; el BOM canónico ya proviene del acta 5.2.
9. Actualizar o reemplazar `README.md`, `docs/architecture.md` y `docs/siigo-integration.md`, que describen componentes históricos.
10. Reducir la respuesta pública de `/api/v1/health`: actualmente expone nombres, conteos de columnas e identificadores recientes que no son necesarios para monitoreo externo.

## Cronología consolidada

### 2026-04: base del sistema

- Se construyeron frontend, esquema MySQL, backend Express y API serverless.
- Se consolidó Vercel como runtime principal.
- Se añadieron autenticación JWT, inventario, producción, recepción, despacho, mermas, aprobaciones, dashboard y webhook BuilderBot.
- Se corrigieron múltiples diferencias entre modelos iniciales y el esquema MySQL real.

### 2026-05 a 2026-06: integraciones y seguridad

- Se añadió SysCafé al backend histórico.
- Se corrigieron consultas MySQL del dashboard.
- Se ejecutó una auditoría de seguridad y se corrigieron hallazgos prioritarios.
- Se corrigieron rutas de búsqueda de inventario.

### 2026-07: catálogo, agente y Siigo

- Se cargó el catálogo Infinity con SKU reales del cliente.
- Se añadieron fixtures controlados para pruebas del agente.
- Se estabilizaron aprobaciones, cierres con merma, trazabilidad, lotes y dashboard.
- Se añadió creación de devoluciones desde dashboard.
- Se implementaron autenticación, sincronización, polling, webhooks y reconciliación de Siigo.
- Se validaron flujos Siigo-first para compras y ventas, además de cotizaciones con reserva.

### 2026-08-04: flujo operativo por roles

- Se implementaron roles y capacidades centralizadas.
- Se añadió OC de proveedor, conciliación y distribución física de recepción.
- Se implementó liberación de OP, BOM/FEFO, confirmación del alistador, ajustes de MP y cierre por Nelly.
- Se implementó factura Siigo como origen de despacho y confirmación física por Anderson.
- Se añadieron notificaciones salientes idempotentes e historial de reintentos.
- Se ejecutaron smokes completos e invariantes de base de datos.
- Se sincronizó el prompt del WMS en BBC.
- Se creó el clasificador faltante para notas de voz.

### 2026-09-02: cierre de produccion y vencimiento heredado

- El lote terminado se genera automaticamente; el operario no dicta su identificador.
- El vencimiento del producto terminado se calcula en servidor usando la fecha mas proxima entre los lotes de materia base en gramos realmente consumidos.
- El cierre falla sin modificar inventario si alguno de esos lotes no tiene un vencimiento valido.
- Dashboard y agente dejaron de solicitar una fecha manual de vencimiento para la produccion interna.
- El lenguaje natural admite referencias cortas como `orden 67` y ubicaciones del plano como `C2`.

## Regla de mantenimiento

Al cerrar una entrega:

1. Actualizar la fecha y el resumen de estado.
2. Agregar el cambio a la cronología.
3. Actualizar capacidades, banderas, integraciones y riesgos afectados.
4. Registrar evidencia de pruebas y despliegue.
5. No incluir contraseñas, tokens, teléfonos completos ni datos del sandbox de terceros.
