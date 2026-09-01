# Flujo de orden de compra y maquila 3Q

Estado: lectura y revision de OC verificadas por WhatsApp. Recepcion directa desde OC implementada y migrada en QA; despliegue y confirmacion fisica de la demo pendientes.

## Principios

- La orden de compra se origina fuera del WMS y se carga como PDF.
- Como la API publica de Siigo no entrega la OC, el PDF es la evidencia documental primaria.
- El PDF de OC se conserva como evidencia y sus items se transcriben de forma estructurada para conciliar lo ordenado con la recepcion fisica.
- Una compra normal se recibe directamente contra una OC abierta. Una factura de compra de Siigo no es requisito operativo.
- Una salida de bodega hacia 3Q puede leerse desde el flujo documental de BuilderBot. La lectura crea un borrador revisable; no confirma ni descuenta inventario.
- 3Q no se representa como bodega ni ubicacion del WMS.
- El material confirmado como enviado sale del stock disponible de la bodega y queda bajo custodia externa de 3Q.
- El WMS conserva la ubicacion interna de origen, pero no inventa una ubicacion dentro de 3Q.

## 1. Carga de la orden de compra

### Entrada por WhatsApp

El flujo `Documentos de Bodega` acepta una OC legible y produce `REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO`. BuilderBot envia al WMS la extraccion literal y una URL temporal del PDF. La API valida la evidencia, descarga el archivo con lista de dominios permitidos, verifica firma y tamano y registra un borrador.

El borrador aparece en `Recepciones > Ordenes de compra`. Un usuario con `reception.create` revisa proveedor sincronizado, fecha, SKU, cantidades y unidades. Solo `Confirmar y crear OC` genera la OC operativa y conserva el PDF; hasta entonces no puede usarse para una recepcion.

El numero visible de la OC no se puede cambiar durante la revision. Las correcciones de lineas quedan conservadas junto con la extraccion original. Repetir el mismo documento no crea otro borrador; cambiar proveedor, SKU, cantidad, unidad o PDF con la misma referencia produce conflicto.

### Entrada manual por dashboard

Un usuario con capacidad `reception.create` registra:

- numero de OC;
- proveedor activo sincronizado desde Siigo;
- fecha;
- PDF original, obligatorio y de maximo 2.5 MB;
- SKU, cantidad y unidad de cada linea.

La API valida extension, MIME, firma `%PDF-`, tamano y hash SHA-256. El documento se guarda separado de los datos estructurados, no se incluye en listados y solo puede descargarse con autenticacion y permiso de lectura de recepciones.

La carga no crea stock. Un reintento con el mismo contenido y PDF devuelve la OC existente; el mismo numero con contenido o PDF diferente se rechaza.

## 2. Recepcion fisica de una compra normal

Nelly selecciona una OC abierta. El WMS prepara una recepcion en borrador usando exclusivamente el saldo pendiente de cada SKU y conserva la unidad de la linea.

La preparacion es idempotente: dos clics, pestanas o reintentos reutilizan el mismo borrador abierto. Esta etapa no crea lotes, stock, movimientos ni kardex.

Por cada linea se registra:

- cantidad y unidad recibidas;
- lote y vencimiento;
- ubicacion dentro de la bodega;
- condicion `DISPONIBLE`, `CUARENTENA`, `RECHAZADO` o `PENDIENTE_DISPOSICION`;
- motivo obligatorio para faltantes, sobrantes o condiciones no disponibles.

Solo la aprobacion fisica crea inventario. La operacion bloquea las filas relevantes, escribe lote, stock, movimiento y kardex en una sola transaccion y registra el usuario aprobador.

Una entrega parcial deja la OC en `RECIBIDA_PARCIAL`. Solo la cantidad `DISPONIBLE` reduce el saldo; cuarentena y rechazo mantienen la diferencia abierta. Cuando todos los productos alcanzan la cantidad aceptada, la OC pasa a `CERRADA`.

Este flujo admite materias primas, insumos y productos `IO`. Un producto `PR` debe ingresar mediante produccion interna y un producto `PT` mediante una orden de maquila 3Q.

## 3. Preparacion de una orden de maquila

Sofi, como `admin`, selecciona una OC con PDF, un producto terminado de modalidad `PT` y la cantidad esperada.

La API comprueba que:

- la OC esta abierta;
- la OC tiene un proveedor sincronizado;
- el producto y la cantidad existen en la OC;
- no existe otra orden activa para el mismo producto y OC;
- el producto es exclusivamente de maquila `PT`;
- existe un BOM vigente de etapa `ENVIO`;
- hay inventario FEFO disponible por lote y ubicacion.

El BOM `ENVIO` es la lista de materiales que se entrega a 3Q. No se filtran productos por nombre: la fuente maestra debe excluir las gomas de este BOM.

Al crear la orden, el WMS reserva los materiales y genera una remision 3Q en borrador. Todavia no descuenta inventario.

## 4. Confirmacion de la salida

### Lectura del documento de salida

El flujo `Documentos de Bodega` de BuilderBot acepta un PDF de salida hacia 3Q y extrae:

- referencia y fecha del documento;
- destinatario, direccion, ciudad/departamento, NIT y telefono;
- quien entrega y quien recibe;
- total de bultos y unidades;
- por linea: codigo/SKU exacto, descripcion, cantidad, vencimiento y lote.

El WMS compara cada codigo exacto con el catalogo activo y la suma de items con el total declarado. Datos faltantes, SKU inexistentes o diferencias dejan el borrador en `REQUIERE_CORRECCION`; un documento consistente queda en `PENDIENTE_REVISION`.

La descripcion nunca se usa para adivinar un SKU. La persona responsable debe revisar y vincular el borrador con una remision WMS antes de confirmar la salida. El PDF es suficiente para diligenciar el borrador si incluye una referencia visible y todos los campos; no sustituye la segunda confirmacion humana.

La remision muestra SKU, cantidad, unidad, lote y ubicacion interna de origen. Sofi confirma la salida fisica mediante una segunda accion explicita.

La confirmacion se ejecuta en una transaccion:

1. bloquea remision, reservas, stock y lotes;
2. valida que la reserva siga disponible;
3. descuenta stock y saldo del lote;
4. registra `movimientos` con referencia `maquila_envio_3q`;
5. registra kardex `ENVIO_MAQUILA_3Q`;
6. cambia la orden a `EN_3Q`.

Repetir la confirmacion no descuenta inventario otra vez. Una remision en borrador se puede cancelar y libera todas sus reservas. Una remision confirmada no se puede cancelar.

## 5. Material adicional

Mientras la orden este `EN_3Q` o `RECIBIDA_PARCIAL`, Sofi puede preparar una remision adicional indicando material, cantidad y motivo.

- El material debe pertenecer al BOM `ENVIO` de esa orden.
- La preparacion usa una clave de idempotencia para evitar reservas duplicadas.
- La salida sigue requiriendo confirmacion separada.
- Al completar la orden, el material adicional enviado se clasifica en la conciliacion como merma de maquila.

## 6. Recepcion desde 3Q

La recepcion de 3Q se inicia desde la orden de maquila y la OC asociada. No depende de importar una factura de compra desde Siigo.

La asociacion se realiza por linea de producto. Una entrega puede contener varios productos y vincular cada uno con una orden 3Q diferente de la misma OC.

Nelly registra por cada entrega:

- cantidad;
- lote definido por 3Q;
- vencimiento definido por 3Q;
- ubicacion de destino dentro del WMS;
- condicion `DISPONIBLE`, `CUARENTENA`, `RECHAZADO` o `PENDIENTE_DISPOSICION`;
- motivo cuando la condicion no es disponible.

Solo `DISPONIBLE` suma inventario utilizable. Cuarentena y rechazo conservan trazabilidad sin aumentar disponibilidad.

## 7. Entregas parciales y cierre

La OC y la orden 3Q acumulan todas las recepciones vinculadas.

- `RECIBIDA_PARCIAL`: lo aceptado disponible aun es menor que el objetivo.
- `COMPLETADA`: la cantidad acumulada disponible alcanza el objetivo.
- El saldo de la OC se calcula con cantidad aceptada acumulada, no solo con cantidad fisicamente descargada.
- Producto rechazado o en cuarentena no cierra la cantidad pendiente.
- La orden no puede completarse mientras tenga remisiones en borrador; primero deben confirmarse o cancelarse.

Al completar, la conciliacion conserva por material: teorico, reservado, enviado, devuelto, conciliado y merma adicional. Las cantidades se muestran por SKU y unidad; nunca se suman gramos y unidades en un mismo total.

## 8. Permisos

| Capacidad | Responsable inicial |
|---|---|
| Consultar maquila | Roles operativos con lectura |
| Crear orden y enviar materiales | `admin` / Sofi |
| Preparar material adicional | `admin` / Sofi |
| Vincular y confirmar recepcion | `recepcion_cierre` / Nelly |

El dashboard aplica controles visuales, pero la autorizacion definitiva siempre se valida en la API.

## 9. Pendientes antes de habilitarlo

1. Sincronizar la identidad de 3Q en `terceros` y comprobar que coincide con el proveedor de la OC. El WMS no admite nombres de proveedor escritos libremente en nuevas OC.
2. Cargar inventario de prueba para los materiales del BOM `ENVIO`; actualmente 11 de las 12 lineas PT no tienen saldo disponible.
3. Desplegar API y dashboard juntos.
4. Ejecutar una prueba con entrega parcial, producto no conforme, material adicional, reintento y cancelacion de remision.
5. Ejecutar la prueba pendiente del lector documental enviando `salida-bodega-3q-prueba.pdf` desde un usuario `admin` al agente. Resultado esperado: borrador `SB-TEST-20260831-001`, seis items, 24.600 unidades, estado `PENDIENTE_REVISION`, visible en `Maquila 3Q > Documentos leidos` y sin cambios en stock, lotes, movimientos o kardex. Repetir el mismo PDF no debe crear un segundo borrador.
