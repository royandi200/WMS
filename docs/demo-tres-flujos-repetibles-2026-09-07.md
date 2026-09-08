# Ensayo repetible: produccion propia, In & Out y 3Q

## Estado y alcance

Preparado el 7 de septiembre de 2026, 10:23 a. m. de Bogota. Es una **preparacion**, no una nueva bateria ejecutada.

- Base consultada directamente: nueve SKU, stock por lote/ubicacion, reservas, BOM y roles.
- Stock suficiente para todo el ejercicio. **No se cambiaron cantidades, reservas, roles ni operaciones existentes.**
- No se llamo a Siigo ni se generaron facturas reales. Los despachos del demo requieren tareas de factura simulada, usando el importador existente.
- No se subieron documentos, enviaron mensajes ni crearon OC/OP/remisiones en esta preparacion.
- Los escenarios usan logica existente. Las preguntas de negocio siguen en [la guia original](demo-cliente-2026-09-02.md), y los pendientes en [la bitacora](bitacora-pruebas-manuales-2026-09.md).
- Comprobacion local: 354/354 pruebas pasan, incluidas tres nuevas del snapshot. Segunda captura a las 10:26 de Bogota: estado identico y diferencias cero en los nueve SKU. No se hizo un nuevo build porque no se modifico la aplicacion.

## Foto inicial

Archivo completo: [baseline.json](../output/qa/demo-trio-20260907/baseline.json).

SHA-256 del estado: `fcc380ed775f37f6e90c5bb8098e7fa9ffcc588b99a5cee45385edb93ec9a39f`.

Incluye cantidades por fila de stock, lotes y estados, ubicaciones, BOM, roles y evidencia de asignaciones de produccion, maquila, despachos y Kardex. No incluye credenciales. Es evidencia acotada a nueve SKU, **no un backup completo ni un restaurador automatico de la base**.

| SKU | Producto | Unidad | Stock registrado | Reservado | Elegible para operar |
|---|---|---|---:|---:|---:|
| 00001-TPBI | Tapas blancas 60 | und | 47 | 19 | 28 |
| 00006-TRP | Tarros 60 | und | 257 | 19 | 238 |
| 00017-ETASH60 | Etiquetas Ashwagandha 60 | und | 311 | 119 | 42 |
| 00018-ETBOS60 | Etiquetas Booster 60 | und | 43.75 | 0 | 43.75 |
| 00035-LNTP60 | Liners 60 | und | 257 | 19 | 238 |
| 00051-MPASH | Gomas Ashwagandha | g | 7851.1 | 3520 | 3830.25 |
| 00102-PTASH60 | Ashwagandha 60, propia PR | und | 173.5 | 0 | 167.75 |
| 00105-PTBOS60 | Booster 60, tercerizada PT | und | 6 | 2 | 4 |
| 00276-PTZNASHWA | Zenova Ashwagandha, IO | und | 44 | 0 | 44 |

Elegible excluye reservas, lotes no disponibles, vencidos y ubicaciones/bodegas inactivas o incompatibles. No siempre equivale a stock menos reservas. La cuarentena puede estar representada en lotes bloqueados sin fila en stock disponible; debe cotejarse por separado. Las fracciones historicas de empaques/PT son datos anteriores de prueba: no se generan ni se corrigen en este ejercicio.

## Roles

| Persona de pruebas | Rol actual verificado | Trabajo |
|---|---|---|
| Juan, usuario 5, linea terminada en 2659 | admin | Crear OP, autorizar reposicion y gestionar remision 3Q |
| Jobana, usuario 20, linea terminada en 9583 | alistador | Confirmar materiales e inicio; confirmar reposicion |
| Datana, usuario 18, linea terminada en 1367 | recepcion_cierre | Recibir y cerrar produccion |

Hacer primero recepciones, produccion y 3Q con estos roles. Agrupar los tres despachos al final: cambiar entonces Datana al rol de despacho mediante la herramienta existente, verificar el rol efectivo y restaurar recepcion_cierre al terminar. En el ensayo se hizo la rotacion y se restauro al final. No usar la linea terminada en 9583 para Datana: corresponde a Jobana. Juan puede mostrar el dashboard durante todo el recorrido.

## Documentos y separacion de sesiones

Usar dos juegos distintos de referencias: `TRIO-E-260907` para ensayo y `TRIO-C-260907` para cliente. No reutilizar las OC de pruebas anteriores: el control de duplicados impediria una segunda operacion identica.

Cada juego necesita OC de insumos, OC IO, salida de bodega a 3Q y OC de PT de 3Q. Los generadores existentes permiten crearlos sin escribir en SQL:

```powershell
node scripts/qa/prepare-repeatable-demo.js --run=TRIO-E-260907 --date=2026-09-07 --io-expiry=2026-09-14 --pdf-only
node scripts/qa/create-demo-3q-exit-pdf.js --run=TRIO-E-260907 --date=2026-09-07
```

Para cliente sustituir E por C y ajustar la fecha de documento a la presentacion. **Estos comandos se dejan preparados; no se ejecutaron en esta etapa.** Los PDF se generan en `output/pdf/demo-<run en minusculas>/`. Revisarlos visualmente antes de enviarlos.

Para controlar FEFO en este ensayo, los lotes nuevos se registraran con vencimiento **2026-09-14**, anterior a los lotes elegibles actuales. Es un dato ficticio deliberado, no una vida util recomendada. Solo sirve si el ensayo y la presentacion ocurren antes de esa fecha. El PT propio hereda el vencimiento de las gomas. Si cambia la fecha o alguien mueve inventario, volver a verificar FEFO antes de operar; no manipular vencimientos historicos.

Lotes de insumos a declarar para el ensayo: `TRIO-E-TPBI`, `TRIO-E-TRP`, `TRIO-E-ETASH`, `TRIO-E-LINER`, `TRIO-E-MPASH`, `TRIO-E-ETBOS`. El lote IO propuesto por el generador es `DEMO-TRIO-E-260907-IO-ZENOVA-001`. Lotes recibidos de 3Q: `TRIO-E-3Q-A` y `TRIO-E-3Q-B`. En cliente usar el prefijo C. Verificar siempre lote, vencimiento, cantidad, condicion y ubicacion antes de confirmar.

**Usabilidad documental pendiente:** el usuario operativo no debe necesitar memorizar ni copiar la referencia tecnica de una OC despues de adjuntarla. La conversacion debe mantener, por remitente y durante un tiempo acotado, el contexto del ultimo borrador cargado y aceptar instrucciones naturales como `revisa la ultima orden de compra que subi`. La respuesta de carga debe ofrecer directamente revisar, corregir o confirmar. Si hay mas de un borrador compatible y no existe un ultimo contexto inequivoco, el sistema debe listar opciones con identificadores visibles y pedir una eleccion; nunca seleccionar silenciosamente una orden distinta.

**Resultado del ensayo y flujo acordado:** la frase natural anterior fallo y el agente pidio el numero exacto de la OC o volver a adjuntar el PDF. Esa busqueda no corresponde al trabajo habitual del usuario. El flujo deseado es: adjuntar OC -> recibir en la misma respuesta el resumen para revisar/corregir/confirmar -> crear la OC operativa una sola vez -> verla automaticamente en `Recepciones pendientes`. A partir de ahi Datana consulta la lista y selecciona el ID visible; no necesita conocer el nombre tecnico de la OC. No se debe pedir reenviar el PDF ya conservado ni agregar un comando separado de busqueda. La aprobacion humana del resumen sigue siendo necesaria cuando existan diferencias reales; una leyenda de demostracion no debe convertirse por si sola en una correccion bloqueante.

## 1. Produccion propia con reposicion

1. Juan sube OC de insumos y revisa el borrador en dashboard. Contiene 12 tapas, 12 tarros, 10 etiquetas Ashwagandha, 12 liners, 2000 g de gomas Ashwagandha y 10 etiquetas Booster. Son seis referencias: no sumar gramos y unidades.
2. Datana consulta recepciones pendientes, prepara el ID real y declara todo recibido disponible. Ubicaciones de ensayo: tapas/etiquetas A1, tarros A11, liners A14, gomas B16. Indicar los seis lotes y vencimiento; revisar resumen y confirmar. Subir el PDF solo no aumenta inventario.
3. Juan: `Vamos a producir 3 tarros de ashwagandha 60 para stock de seguridad.` Guardar el ID de la nueva OP. Debe mostrar plan 3 y reservar 3 de cada empaque y 540 g. Jobana recibe el alistamiento.
4. Jobana: `Ya aliste los materiales de la orden ID <OP>.` Debe pasar a EN_PROCESO, descontar esos materiales una vez y avisar a Juan y Datana. Verificar que los lotes elegidos sean los nuevos del ensayo.
5. Juan: `En la orden <OP> se perdio un tarro completo por contaminacion y no se recupero ningun material. Autorizo reponer todos los materiales del BOM completo para fabricar 1 unidad faltante y completar las 3 unidades de la orden.` Debe reservar 1 tapa, 1 tarro, 1 etiqueta, 1 liner y 180 g adicionales, sin consumirlos todavia; avisar a Jobana.
6. Jobana: `Ya aliste la reposicion de la orden <OP>.` Debe consumir solo el adicional y notificar a Juan/Datana. El plan sigue en 3.
7. Datana: `Cerramos la orden <OP> con 3 tarros conformes y 1 merma por contaminacion. Dejar el producto terminado en C2.` Resultado: lote WMS nuevo con 3, una merma PT de 1, y aviso de cierre al admin. No se descuentan nuevamente los materiales al cerrar.
8. Despacho final simulado: 1 tarro del nuevo lote, queda 2. Repetir confirmacion: cero nuevo descuento. Trazar desde lote PT hasta MP recibida y cliente del despacho.

**Contabilidad de materiales del ejercicio:** salen 4 unidades de cada empaque y 720 g en total (inicial + reposicion). La perdida se declara como motivo de reposicion y se registra como una sola merma PT al cerrar. No registrar ademas la misma perdida en cada MP ni una segunda merma PT. Este caso fue probado en MAN-020; esta nueva ejecucion queda pendiente.

## 2. In & Out con recepcion mixta

1. Juan sube OC IO por 5 Zenova Ashwagandha; revisa y crea OC desde borrador.
2. Datana recibe 4 disponibles en B13 y 1 en cuarentena en CUAR-C-1-01 por empaque sospechoso. Mismo lote proveedor y vencimiento verificados. Preparar las dos partidas, revisar resumen y confirmar una sola vez.
3. Verificar: fisicamente llegaron 5; disponible aumenta solo 4. La unidad de cuarentena queda trazable y no despachable. Con la regla actual la OC queda parcial porque falta 1 aceptada; no prometer que la cuarentena cierre automaticamente esa diferencia.
4. Crear tarea de despacho simulado por 2 y verificar su picking: solo del lote disponible, nunca de la partida bloqueada. Confirmar y repetir confirmacion. Resultado del ejercicio: 2 disponibles restantes del lote nuevo y 1 bloqueada.
5. Trazabilidad: OC/recepcion -> lote -> despacho/cliente y ubicacion de la partida bloqueada. No liberar ni destruir la unidad en cuarentena durante este caso.

**Pendiente de definicion con el usuario antes de la demostracion al cliente:** confirmar cuales seran las ubicaciones operativas oficiales para lotes en `CUARENTENA` y para `DEVOLUCION`. `CUAR-C-1-01` es la ubicacion configurada para este ensayo y no debe presentarse como una decision definitiva del negocio hasta obtener esa validacion.

**Requisito de consulta del dashboard:** las partidas internas bloqueadas `RECBLK-*` deben poder encontrarse tanto por su identificador interno como por el lote fisico del proveedor. En este ensayo la unidad en cuarentena de `DEMO-TRIO-E-260907-IO-ZENOVA-001` genero la partida `RECBLK-870f34e63ee4b6bb97e655a656bb22d5`. Si la busqueda no devuelve esa partida con cantidad 1, condicion `CUARENTENA`, motivo `empaque sospechoso` y ubicacion `CUAR-C-1-01`, registrar el resultado como brecha de visibilidad; no confundirlo con stock disponible.

**Hallazgo del ensayo pendiente de corregir:** el Kardex recorta visualmente los LPN a 20 caracteres y presenta `RECBLK-870f34e63ee4b6bb9...` en lugar de mostrar completo `RECBLK-870f34e63ee4b6bb97e655a656bb22d5`. La base de datos conserva el valor completo; el recorte proviene de `KardexPage.jsx`, que construye `lpnShort` con `slice(0, 20)`. Aunque el valor completo queda en el atributo de ayuda al pasar el cursor, eso no es suficiente para operar, copiar, buscar ni mostrar la trazabilidad al cliente. Corregir la visualizacion y permitir copiar el identificador completo antes de la demostracion.

No probar falta global de stock pidiendo 5: existen otras 44 unidades disponibles anteriores. La dificultad es la segregacion y exclusion del inventario bloqueado, no un agotamiento artificial de todo el SKU.

## 3. Maquila 3Q con recepcion parcial

1. Juan sube la salida de bodega a 3Q: 4 tapas, 4 tarros, 4 etiquetas Booster y 4 liners. Revisar el borrador, crear la remision operativa para 4 Booster 60 y confirmar la salida fisica. **No enviar gomas a 3Q.**
2. Verificar consumo desde ubicaciones de origen, custodia externa y estado EN_3Q_PENDIENTE_OC; no inventar una ubicacion interna de 3Q. El PDF solo no descuenta.
3. Subir OC 3Q por 4 Booster, revisarla y vincularla con la remision ya enviada. Debe aparecer recepcion pendiente de maquila.
4. Datana recibe **2** Booster disponibles en C8, lote `TRIO-E-3Q-A`, vencimiento 2026-09-14. Usar Recepciones > Confirmar recepcion > Producto desde 3Q si la conversacion remite al formulario. Debe quedar acumulado 2 de 4, saldo pendiente 2 y orden abierta.
5. Recibir las **otras 2**, lote `TRIO-E-3Q-B`, mismo vencimiento/C8. Debe quedar acumulado 4 de 4. No volver a enviar ni descontar los materiales iniciales.
6. Crear despacho simulado por 2. Verificar que FEFO seleccione el nuevo lote A; confirmar y repetir. Quedan 2 PT nuevos disponibles (lote B). Trazar cliente <- PT recibido <- remision 3Q <- lotes de insumos enviados.

**Hallazgos del ensayo pendientes antes de la demostracion:** el borrador `DEMO-TRIO-E-260907-SALIDA-3Q` fue leido con cuatro items y 16 unidades correctas, sin gomas y sin mover inventario. Quedan estos ajustes:

- El registro tiene ID interno 32, pero la tarjeta de `Documentos leidos` no renderiza `row.id`; mostrar un identificador operativo visible.
- El dashboard presenta el valor tecnico `Origen BUILDERBOT`. Para el usuario debe rotularse `Origen WhatsApp` sin cambiar la procedencia tecnica almacenada.
- El PDF del ensayo imprime deliberadamente `Bultos: 1` porque `create-demo-3q-exit-pdf.js` fija `totalPackages: 1`; no es un error de extraccion. Validar con el usuario si se conservara este dato y, de hacerlo, presentarlo claramente como `1 bulto logistico | 16 unidades`, sin confundir ambas magnitudes.
- La referencia a `Sofi` tambien proviene del PDF, cuyo generador fija `sender: 'SOFI - ADMINISTRADORA'`, aunque el actor definido para esta prueba es Juan/admin. Ajustar el fixture del cliente o confirmar el responsable real antes de generarlo.
- El dashboard permite revisar/corregir el documento y crear la remision por separado, pero no expone una accion para vincular este borrador de salida con la remision operativa; tampoco se encontro una escritura de `documentos_bodega_borrador.maquila_envio_id` en el flujo actual. Cerrar la vinculacion documento -> remision para que la trazabilidad prometida sea demostrable.
- Validar con el usuario si una misma remision fisica hacia 3Q puede incluir varios SKU de producto terminado. El formulario actual solo ofrece un campo `SKU del producto terminado PT` y no permite agregar filas; el modelo `ordenes_maquila` tambien guarda un unico `producto_id` por orden. Los varios SKU que aparecen en el picking son materiales del BOM, no varios productos terminados. Si el negocio agrupa PT distintos en una remision, se requiere ampliar interfaz, contrato y modelo o definir explicitamente una remision separada por cada SKU. Agregar una prueba mult-SKU despues de esa decision; no cambiar el caso principal de Booster 60.
- **Prioridad principal acordada - simplificar maquila tercerizada:** la salida hacia 3Q debe reutilizar el mismo flujo operativo de despacho que se usa para entregar al cliente final: crear la tarea, hacer picking FEFO, revisar lotes y ubicaciones, confirmar la salida de manera idempotente y conservar la trazabilidad. En este caso el destinatario es el maquilador 3Q y los articulos despachados son materias primas/insumos, no producto terminado. El flujo comun debe distinguir tipo de destinatario y tipo de documento (`factura` para cliente o `remision` para 3Q), admitir SKU de MP y PT y enlazar el despacho con la orden de maquila y el documento cargado. La integracion no puede crear dos salidas ni descontar inventario nuevamente al actualizar la custodia externa. La prueba frente al cliente debe mostrar los mismos controles de despacho en ambos destinos.
- La OC operativa creada desde el PDF debe vincularse **manualmente** con la orden 3Q para evitar asociaciones equivocadas. La pestaña `Vincular OC` debe mostrar solo candidatos compatibles y presentar producto, cantidad y maquilador antes de confirmar. Mientras no este vinculada, la OC no debe ofrecerse como recepcion directa ordinaria porque podria ingresar el PT por una ruta equivocada. En el ensayo, la OC ID 24 se vinculo manualmente con `MQ-3Q-20260908-000011`.
- **Decision aplazada - recepcion 3Q por WhatsApp:** por ahora no se implementara la preparacion/confirmacion parcial de una recepcion 3Q por WhatsApp ni la acumulacion de datos fisicos enviados en varios mensajes. WhatsApp puede listar la recepcion pendiente y remitir al dashboard; la operacion se completa en `Recepciones > Confirmar recepcion > Producto desde 3Q`. Para la siguiente prueba, los datos que si se registren por WhatsApp deben enviarse completos en un solo mensaje. No presentar al cliente que la recepcion 3Q funciona de punta a punta por WhatsApp.
- **Identificadores WhatsApp sin colision:** las recepciones directas se muestran y seleccionan como `OC ID N`; las de maquila, como `MQ ID N`. Un numero solo, `ID N` o una seleccion posicional se considera ambiguo y no puede preparar ni confirmar una OC. `MQ ID` solamente orienta al formulario `Producto desde 3Q` mientras siga aplazada la recepcion 3Q completa por WhatsApp.

### Flujo objetivo prioritario de maquila tercerizada

1. Cargar por WhatsApp el documento de salida hacia 3Q y obtener un unico resumen revisable con todas sus lineas.
2. Confirmar ese resumen una sola vez para crear y enlazar la orden de maquila, la remision y la tarea de despacho. Los materiales, cantidades y destinatario se toman del documento; solo se completan los datos que el documento no contiene, como el producto terminado esperado.
3. Ejecutar el picking FEFO y la confirmacion fisica con los mismos controles del despacho a cliente, cambiando el destinatario a 3Q y el documento comercial de factura a remision.
4. Descontar inventario exactamente una vez y reflejar esos mismos lotes como custodia externa de 3Q, conservando el enlace documento -> despacho/remision -> orden de maquila.
5. Al cargar la OC de producto terminado, vincularla manualmente. El sistema filtra candidatos compatibles y vuelve a mostrar maquilador, producto y cantidad antes de aceptar el enlace.
6. Recibir devoluciones parciales o totales de 3Q desde el dashboard, conservando lote, vencimiento, condicion y ubicacion por cada entrega.

## Pendientes transversales del dashboard

- **SKU visible en Kardex:** cada fila y cada resultado de busqueda del Kardex debe mostrar el SKU junto al nombre del producto. El usuario no debe tener que abrir otro modulo ni inferirlo desde el lote o la referencia. Mantener visibles tambien lote completo, tipo de movimiento, cantidad, saldo, referencia, fecha y actor.
- **Bandeja de recepciones pendientes y borradores:** despues de crear una orden de compra, `Recepciones` debe mostrar claramente las recepciones pendientes de preparar y los borradores/en proceso ya iniciados, de forma equivalente a las pestañas `Pendientes` e `Historico` de `Despachos`. La bandeja debe distinguir el estado, conservar el ID operativo, OC, proveedor, SKU/producto, cantidad esperada, recibida y saldo, y permitir reanudar el borrador sin crear otra recepcion. Las recepciones completadas deben quedar separadas en `Historico`.

## Despachos simulados y orden de ejecucion

El apoyo tecnico crea las tareas **despues** de disponer de los PT, no antes. Comandos existentes: `node scripts/qa/prepare-demo-dispatch.js --scenario=own|io|outsourcing --run=TRIO-E-260907`, ejecutando un escenario real por comando. Por defecto son consultas; revisar el resultado y usar los flags apply documentados en el script solo al llegar al paso correspondiente.

El helper actual tiene fecha de factura de demo fija (2026-09-02), cantidades 1/2/2 y notificaciones apagadas salvo `--notify`. No representa una factura emitida hoy ni una prueba de sincronizacion Siigo. Consultar despachos pendientes por WhatsApp para continuar, sin depender de un aviso proactivo.

**Punto de control obligatorio:** comprobar en dashboard/SQL los lotes del picking antes de confirmar. Si selecciona lotes anteriores, detener y resolver la preparacion; no presentar como trazabilidad de este ensayo un despacho de mercancia antigua.

**Decision para la proxima prueba - limpieza en lugar de filtros:** la consulta de WhatsApp mostro cinco despachos porque, ademas de los IDs 63, 64 y 65 del ensayo, seguian visibles los IDs 52 y 54 de pruebas anteriores en `PENDIENTE_STOCK`. No se implementaran ahora filtros ni conciliacion de historicos. Antes de la siguiente prueba se limpiara/restablecera la base de datos de forma acotada y se iniciara una corrida ordenada. La limpieza debe preservar una copia de la evidencia del ensayo y abarcar inventario, lotes, reservas, asignaciones, documentos y tareas relacionadas; no limitarse a modificar `stock`.

**Pendiente de evidencia documental:** en `Despachos > Historico`, cada despacho realizado debe permitir **exportar o descargar su PDF**. La accion debe seguir disponible despues de confirmar el despacho y el documento debe identificar como minimo factura/referencia, numero de despacho, cliente, fecha, productos, cantidades, lotes y ubicaciones. La exportacion es solo documental: no puede repetir el descuento ni crear nuevos movimientos. En el ensayo actual solo se observa la accion `Hoja`; validar si genera un PDF descargable y, si no, agregar una accion explicita `Exportar PDF`.

**Confirmacion en dos pasos en dashboard:** el boton `Confirmar` de un despacho pendiente no debe ejecutar la salida con el primer clic. El primer clic debe abrir un modal de revision, sin modificar inventario, mostrando despacho, factura, cliente, productos/SKU, cantidades, lotes y ubicaciones, junto con una advertencia clara de que la confirmacion descontara inventario. La salida solo se ejecuta mediante un segundo boton explicito, por ejemplo `Confirmar salida`, con opcion visible de cancelar/cerrar. Evitar que la accion irreversible tenga el foco predeterminado, bloquear doble envio mientras procesa y conservar la idempotencia del backend. Esto iguala en el dashboard la intencionalidad que WhatsApp exige al escribir una confirmacion explicita y evita despachos involuntarios por un clic accidental.

## Saldos finales esperados

Solo si se ejecuta lo anterior sin otras operaciones concurrentes. Las reservas antiguas permanecen intactas y las reservas de este ensayo deben quedar consumidas/liberadas.

| SKU | Variacion en stock registrado | Stock final esperado | Reservado final | Elegible final esperado |
|---|---:|---:|---:|---:|
| 00001-TPBI | +12 -4 produccion -4 envio 3Q = +4 | 51 | 19 | 32 |
| 00006-TRP | +4 | 261 | 19 | 242 |
| 00017-ETASH60 | +10 -4 = +6 | 317 | 119 | 48 |
| 00018-ETBOS60 | +10 -4 = +6 | 49.75 | 0 | 49.75 |
| 00035-LNTP60 | +4 | 261 | 19 | 242 |
| 00051-MPASH | +2000 -720 = +1280 g | 9131.1 | 3520 | 5110.25 |
| 00102-PTASH60 | +3 -1 = +2 | 175.5 | 0 | 169.75 |
| 00105-PTBOS60 | +2 +2 -2 = +2 | 8 | 2 | 6 |
| 00276-PTZNASHWA | +4 disponibles -2 = +2 | 46 | 0 | 46 |

Adicional: IO +1 en cuarentena, fuera de esos 46 disponibles; una merma PT propia de 1. Los saldos por lote prevalecen sobre totales para comprobar trazabilidad.

## Repetir frente al cliente

1. Guardar snapshot al terminar el ensayo con otra ruta; nunca sobrescribir el inicial.
2. Comparar diferencias y conciliar movimientos de las OC/OP/REM/DSP del ensayo. No mezclar ejecuciones ni tocar reservas anteriores.
3. Antes de cliente, preparar un restablecimiento acotado de los datos de prueba o una copia de entorno desde el estado inicial. **Todavia no se ejecuto ni se construyo un reset automatico.** No bastaria con actualizar `stock`: tambien importan lotes, reservas, asignaciones y tareas abiertas. Conservar la evidencia del ensayo fuera del estado que se restablezca.
4. No afirmar igualdad exacta hasta verificar otra vez cantidades, reservas y elegibilidad por lote/ubicacion. Los IDs/referencias del nuevo recorrido seran diferentes por idempotencia, aunque se repitan cantidades y dificultad.
5. Generar el juego C; verificar fecha/FEFO. Ejecutar la misma secuencia. Si no se restablece el inicio, se puede repetir el flujo, pero **no** prometer los mismos saldos globales.

Consulta de comparacion, solo lectura:

```powershell
node scripts/qa/snapshot-demo-trio.js --compare=output/qa/demo-trio-20260907/baseline.json --out=output/qa/demo-trio-20260907/despues-ensayo.json
```

El archivo de salida es exclusivo: si existe, el comando no lo sobrescribe. Para otra lectura usar un nombre nuevo u omitir `--out`. No contiene un modo de escritura SQL.

## Registro del ensayo

| Paso | Hora Bogota | ID real | Resultado / novedad |
|---|---|---|---|
| OC insumos y recepcion | 07-08/09, noche | OC 22; recepcion 101 | `REC-OC-22-001` completada: seis SKU y cantidades esperadas, lotes/ubicaciones/vencimiento correctos. La recepcion por mensajes parciales no acumula contexto. |
| OP, inicio y reposicion | 07-08/09, noche | OP 87 | `OP-20260908-000087`: FEFO correcto; consumo inicial y reposicion adicional ejecutados una vez; avisos a roles correctos. |
| Cierre propio | 07-08/09, noche | OP 87; merma 43 | Tres conformes en `LPN-OP-20260908-000087`, C2; una merma por contaminacion; el despacho posterior dejo saldo 2. |
| OC IO y recepcion mixta | 07-08/09, noche | OC 23; recepcion 102; despacho 64 | Cuatro disponibles en B13 y una en cuarentena; despacho tomo solo dos disponibles y dejo dos. Lote bloqueado `RECBLK-870f34e63ee4b6bb97e655a656bb22d5` intacto. |
| Salida a 3Q y vinculo OC | 07-08/09, noche | documento 32; MQ 11; remision 12; documento 33; OC 24 | Cuatro SKU de insumos enviados una vez, sin gomas; remision confirmada y OC vinculada manualmente. Pendiente de simplificar la preparacion desde el documento; la vinculacion de OC se conserva manual por decision de control. |
| Recepcion 3Q parcial y final | 07/09 23:36-23:40 | recepciones 103 y 104 | Dos entregas de 2: lotes `TRIO-E-3Q-A` y `TRIO-E-3Q-B`, C8, vencimiento 2026-09-14. Orden MQ completada 4/4 y OC cerrada. |
| Despachos 1 / 2 / 2 e idempotencia | 08/09 08:08-08:33 | despachos 63, 64 y 65 | Los tres despachados desde los lotes del ensayo. Reintentos sin nuevo movimiento. ID 65 se confirmo primero por dashboard/Admin y se reintento dos veces por WhatsApp/Datana: idempotencia cruzada correcta. El dashboard requiere confirmacion en dos pasos. |
| Trazabilidad y comparacion SQL final | 08/09 08:35 | snapshot final | Variaciones de los nueve SKU coinciden exactamente con los saldos esperados; reservas sin delta. Evidencia: `output/qa/demo-trio-20260907/despues-ensayo-final-20260908.json`. Roles finales restaurados: Juan admin, Datana recepcion_cierre, Jobana alistador. |
