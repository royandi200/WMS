# Guion maestro de demo WMS - 2026-09-02

## Objetivo

Demostrar, sin conectarse a Siigo ni a la operacion real del cliente, tres recorridos completos y trazables:

1. Produccion propia (`PR`): OC de insumos, recepcion, FEFO, produccion, lote terminado y despacho.
2. In-and-out (`IO`): OC, recepcion de producto terminado y despacho, sin orden de produccion.
3. Maquila tercerizada (`PT`): OC de producto esperado, envio de materiales a 3Q, recepciones parciales, lote terminado y despacho.

Los datos son de desarrollo. Se usan SKU reales, pero documentos, terceros, cantidades, lotes, facturas y clientes del demo son sinteticos y no tienen validez comercial.

## Mensaje central

El WMS controla lo que ocurre fisicamente en la bodega. La OC define lo esperado; la recepcion, produccion o salida confirma lo que realmente ocurrio. La modalidad cambia el recorrido, pero el lote permanece trazable hasta el cliente final.

## Preparacion confirmada

| Elemento | Estado preparado |
|---|---|
| Administrador | Juan, linea `3174442659`, rol `admin`. |
| Recepcion y cierre | Datana, linea `3125031367`, rol `recepcion_cierre`. |
| Alistamiento | Jobana, linea `3158269583`, rol `alistador`. |
| Linea del agente | `573173292904`. |
| PDF de insumos para el cliente | `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-INSUMOS.pdf`. |
| PDF In-and-out para el cliente | `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-IO.pdf`. |
| PDF de salida a 3Q para el cliente | `output/pdf/demo-presentacion/DEMO-PRESENTACION-SALIDA-3Q.pdf`. |
| PDF de OC 3Q para el cliente | `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-3Q.pdf`. |
| Produccion propia | `00102-PTASH60`, Ashwagandha x 60, objetivo 3 und. |
| In-and-out | `00276-PTZNASHWA`, Zenova Ashwagandha, recepcion de 5 und. |
| Maquila 3Q | `00105-PTBOS60`, Booster x 60, objetivo 4 und. |
| Stock | La OC de insumos de la presentacion completa los materiales de produccion propia y 3Q. |
| Siigo | Fuera de la demo. Los despachos nacen de facturas sinteticas locales procesadas por el importador determinista. |

La OC de insumos debe recibirse primero. Aporta, entre otros, 10 etiquetas Booster `00018-ETBOS60`, necesarias para el ejemplo de 3Q.

## Paquete que se usa frente al cliente

Usar exclusivamente los archivos de `output/pdf/demo-presentacion/`. Los documentos de `demo-ensayo-final` son evidencia de la prueba previa y no deben cargarse de nuevo durante la presentacion.

| Orden | Archivo | Referencia que debe leer el WMS | Contenido clave |
|---|---|---|---|
| 1 | `DEMO-PRESENTACION-OC-INSUMOS.pdf` | `DEMO-PRESENTACION-OC-INSUMOS` | Seis insumos: tapas, tarros, etiquetas Ashwagandha, liners, 2000 g de gomas y etiquetas Booster. |
| 2 | `DEMO-PRESENTACION-OC-IO.pdf` | `DEMO-PRESENTACION-OC-IO` | 5 und de `00276-PTZNASHWA`, lote propuesto `DEMO-PRESENTACION-IO-ZENOVA-001`, vence `2027-11-29`. |
| 3 | `DEMO-PRESENTACION-SALIDA-3Q.pdf` | `DEMO-PRESENTACION-SALIDA-3Q` | Salida esperada de 4 tapas, 4 tarros, 4 etiquetas Booster y 4 liners hacia 3Q. |
| 4 | `DEMO-PRESENTACION-OC-3Q.pdf` | `DEMO-PRESENTACION-OC-3Q` | OC por 4 und de `00105-PTBOS60` esperadas desde 3Q. |

Los ID cortos se asignan al crear cada registro. Anotarlos durante la demo como `<ID_INSUMOS>`, `<ID_IO>`, `<ID_OC_3Q>`, `<ID_OP>` y `<ID_DESPACHO>`; no reutilizar los ID del ensayo.

## Corridas independientes

No se borran ni revierten movimientos para repetir la demo. Hay dos juegos documentales independientes:

| Uso | Insumos | In-and-out | Maquila 3Q |
|---|---|---|---|
| Ensayo actual | ID `4` / `DEMO-20260902-OC-INSUMOS` | ID `6` / `DEMO-20260902-DOC-IO-001` | ID `7` / `DEMO-20260902-OC-3Q-001` |
| Presentacion al cliente | ID `8` / `DEMO-CLIENTE-OC-INSUMOS` | ID `9` / `DEMO-CLIENTE-OC-IO` | ID `10` / `DEMO-CLIENTE-OC-3Q` |

Los ID `8`, `9` y `10` son contingencias precargadas. El recorrido principal frente al cliente carga los PDF de `demo-presentacion` y usa los nuevos ID que asigne el WMS.

Los ID anteriores son contingencias precargadas. El camino principal para mostrar la carga desde documentos usa dos paquetes documentales independientes:

| Documento | Ensayo final | Presentacion |
|---|---|---|
| OC de insumos | `output/pdf/demo-ensayo-final/DEMO-ENSAYO-FINAL-OC-INSUMOS.pdf` | `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-INSUMOS.pdf` |
| OC in-and-out | `output/pdf/demo-ensayo-final/DEMO-ENSAYO-FINAL-OC-IO.pdf` | `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-IO.pdf` |
| OC de producto esperado 3Q | `output/pdf/demo-ensayo-final/DEMO-ENSAYO-FINAL-OC-3Q.pdf` | `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-3Q.pdf` |
| Salida de materiales hacia 3Q | `output/pdf/demo-ensayo-final/DEMO-ENSAYO-FINAL-SALIDA-3Q.pdf` | `output/pdf/demo-presentacion/DEMO-PRESENTACION-SALIDA-3Q.pdf` |

Las tres OC se envian al flujo documental y luego se revisan en el dashboard. La salida 3Q se lee como borrador documental; la remision operativa del WMS sigue asignando lotes FEFO y exigiendo confirmacion. Ninguno de estos PDF crea inventario por si solo.

Valores que cambian en la corrida del cliente:

| Dato | Ensayo | Cliente |
|---|---|---|
| Lote de gomas recibido | `DEMO-GOMAS-E2E-001` | `DEMO-PRESENTACION-GOMAS-001` |
| Vencimiento de gomas | `2026-09-15` | `2026-09-14` |
| Lote IO | `DEMO-IO-ZENOVA-001` | `DEMO-PRESENTACION-IO-ZENOVA-001` |
| Vencimiento IO | `2027-11-30` | `2027-11-29` |
| Lotes 3Q | `3Q-DEMO-BOOSTER-A/B` | `3Q-PRESENTACION-BOOSTER-A/B` |
| Vencimiento PT 3Q | `2027-12-31` | `2027-12-30` |
| Facturas sinteticas | Sin `--run` | Agregar `--run=PRESENTACION` |

Los vencimientos de la corrida del cliente son anteriores a los del ensayo, pero siguen vigentes. Esto hace que FEFO priorice los lotes de la presentacion sobre remanentes del ensayo.

Para crear una nueva corrida futura sin tocar las anteriores:

```powershell
node scripts\qa\prepare-repeatable-demo.js --run=NUEVA-CORRIDA --date=2026-09-03
node scripts\qa\prepare-repeatable-demo.js --run=NUEVA-CORRIDA --date=2026-09-03 --apply --yes-i-understand-this-creates-demo-purchase-orders
```

El primer comando es un dry-run. El segundo genera tres PDF y tres OC. Repetir exactamente el segundo comando devuelve los mismos registros y no los duplica. `--refresh-unused` solo puede regenerar un fixture mientras siga `CARGADA` y no tenga recepciones ni ordenes 3Q.

## Orden y roles

| Bloque | Responsable | Rol | Acciones |
|---|---|---|---|
| 1. Entradas | Datana | `recepcion_cierre` | Recibir la OC de insumos y la OC IO cargadas desde los PDF de presentacion. |
| 2. Alistamiento | Jobana | `alistador` | Recibir el aviso, confirmar materiales e iniciar la OP propia. |
| 3. Cierres y 3Q | Datana | `recepcion_cierre` | Cerrar la OP y recibir dos entregas de 3Q. |
| 4. Salidas | Jobana | `despacho` | Confirmar los despachos PR, IO y PT. |
| 5. Restauracion | Jobana | `alistador` | Dejar la linea en su rol base. |

Comando de apoyo, fuera de la vista del cliente:

```powershell
node scripts\qa\set-demo-user-role.js --phone=3158269583 --role=<ROL> --actor-phone=3174442659
```

Comprobar el rol efectivo despues de cada cambio antes de una accion de inventario.

## Apertura

1. Mostrar `Resumen`, `Productos`, `Inventario`, `Recepciones`, `Produccion`, `Maquila 3Q` y `Despachos`.
2. Explicar las modalidades `PR`, `IO` y `PT`.
3. Aclarar que preparar o revisar no modifica inventario. Solo una confirmacion explicita y autorizada crea movimientos.
4. Mostrar que nombres comunes e ID cortos evitan dictar SKU o codigos largos por audio.

## Escenario 1: produccion propia

### 1. Recibir insumos

Prerequisito: Datana en `recepcion_cierre`.

1. Enviar por WhatsApp `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-INSUMOS.pdf` con el texto: `Carga esta orden de compra de insumos para recepcion.`
2. Verificar que el agente cree el borrador `DEMO-PRESENTACION-OC-INSUMOS` en `PENDIENTE_REVISION`, sin crear stock.
3. En `Recepciones > Ordenes de compra`, revisar proveedor, seis items y cantidades; pulsar `Confirmar y crear OC` y anotar el ID como `<ID_INSUMOS>`.
4. Preguntar en WhatsApp: `Que recepciones pendientes hay?`
5. Decir: `Prepara la recepcion ID <ID_INSUMOS>`.
6. Reportar con alias:

   `Para la recepcion ID <ID_INSUMOS> llegaron completos: 12 tapas blancas 60 disponibles en A8; 12 tarros 60 disponibles en A11; 10 etiquetas ashwa 60 disponibles en A1; 12 liners 60 disponibles en A14; 2000 gramos de gomas ashwa disponibles en B16, lote DEMO-PRESENTACION-GOMAS-001, vencen el 14 de septiembre de 2026; y 10 etiquetas booster 60 disponibles en A1.`

7. Revisar el resumen: seis productos, cantidades, condiciones y ubicaciones. Solo las gomas requieren lote del proveedor.
8. Confirmar: `Confirmo la recepcion ID <ID_INSUMOS>`.
9. Repetir la confirmacion. No debe duplicar stock ni Kardex.
10. Mostrar OC, PDF, recepcion, diferencias y movimientos.

Punto para decidir con el cliente: despues de preparar la recepcion, definir si Nelly debe validar y declarar cada SKU con su cantidad, condicion y ubicacion, o si una recepcion completa y sin diferencias puede confirmarse directamente con `Confirmo la recepcion ID <ID_INSUMOS>`. Recomendacion para el demo: mostrar el resumen detallado antes de confirmar y explicar que la confirmacion abreviada solo deberia aplicar cuando todo coincide; cualquier diferencia, cuarentena o rechazo exigiria el detalle por item.

El vencimiento corto es sintetico y deliberado: permite demostrar FEFO y que el PT hereda el vencimiento de las gomas consumidas.

Resultado del ensayo: recepcion `REC-OC-4-001` completada sin diferencias y con seis entradas de Kardex. El lote de gomas quedo como `BEMO-GOMAS-E2E-001` por una transcripcion de voz y fue visible en el resumen confirmado por el usuario. Para el resto de esta corrida se conserva ese identificador real. El caso demuestra que los lotes deben cotejarse visualmente y no depender solo del audio.

### 2. Liberar e iniciar produccion

Antes de liberar la OP, verificar que Jobana sea la unica operadora activa con rol `alistador`. Datana permanece en `recepcion_cierre`.

1. Juan dice: `Vamos a producir tres tarros de ashwagandha 60`.
2. El agente debe preguntar el destino antes de crear la orden.
3. Responder: `Para stock de seguridad`.
4. Verificar SKU y nombre, cantidad interpretada 3 und, destino, BOM, FEFO, ubicaciones, ID corto y codigo OP.
5. Confirmar que Jobana recibe el mensaje de alistamiento.

Resultado del ensayo: la OP `OP-20260902-000068` se creo una sola vez y quedo `APROBADA`, con materiales reservados. Juan recibio dos mensajes porque no habia un alistador activo: uno fue la respuesta directa y otro la notificacion enviada al `admin` de respaldo. Se creo a Jobana como `alistador` y Datana se conservo en `recepcion_cierre`. No hubo doble ejecucion de la orden.
6. Jobana dice: `Ya aliste los materiales de la orden ID <ID_OP>`.
7. Verificar `EN_PROCESO` y un solo descuento de cada material.

Resultado del ensayo: Jobana confirmo la OP `68`; quedo `F1 / EN_PROCESO`. Se consumieron una sola vez 3 tarros, 3 tapas, 3 etiquetas, 3 liners y 540 g de gomas. El Kardex contiene seis salidas porque las tres etiquetas se completaron con 1 und de un lote y 2 und de otro por FEFO. Jobana recibio la respuesta operativa; Juan y Datana recibieron exactamente una notificacion `production_started:68` cada uno.

| Evento | Destinatario | Contenido esperado |
|---|---|---|
| OP liberada | Alistador | OP, PT, cantidad, destino, BOM, lotes FEFO, ubicaciones e instruccion. |
| Materiales confirmados | Alistador | OP en proceso y lotes entregados. |
| Produccion iniciada | Sofi/admin y Nelly | OP, PT, plan, destino, actor, fecha, hora, materiales y estado. |

### 3. Cerrar produccion

El recorrido principal usa 3 conformes y 0 merma. La OP 67 cerrada queda como evidencia de merma si el cliente desea verla.

1. Datana, que permanece en `recepcion_cierre`, dice: `Cerramos la orden ID <ID_OP> con 3 unidades conformes y cero merma. Dejarlas en C2.`
2. El WMS genera el lote; el usuario no lo dicta.
3. El vencimiento esperado es `2026-09-14`, heredado de las gomas de la presentacion.
4. Juan debe recibir plan, conformes, merma, lote PT, ubicacion, vencimiento, actor y conciliacion.
5. Repetir el cierre: debe informar que ya estaba cerrada y no modificar inventario.
6. Consultar la trazabilidad del lote PT.

Resultado del ensayo: OP `OP-20260902-000068` en `F5/CERRADA`, plan 3, conformes 3 y merma 0. Se creo una sola entrada de 3 und en el lote `LPN-OP-20260902-000068`, disponible en `C2`, sin reserva y con vencimiento `2026-09-15` heredado de las gomas. Datana recibio la respuesta directa del cierre y Juan recibio una notificacion `production_closed:68`; no hubo doble movimiento.

Idempotencia manual validada: Datana repitio el cierre y luego Juan lo intento desde `admin`. Ambos recibieron el actor y la hora del cierre original y la indicacion `No se modifico inventario`. La base conserva una sola entrada por 3 und, un solo lote terminado y una sola notificacion de cierre enviada.

`Neto entregado` es lo que salio del disponible hacia produccion; `merma de proceso` es la perdida documentada; `uso productivo estimado` es neto menos merma. Un sobrante fisico debe devolverse antes del cierre para volver a estar disponible.

### 4. Preparar despacho PR

Ejecutar despues del cierre y antes del bloque final de despachos:

```powershell
node scripts\qa\prepare-demo-dispatch.js --scenario=own --run=PRESENTACION
node scripts\qa\prepare-demo-dispatch.js --scenario=own --run=PRESENTACION --apply --yes-i-understand-this-creates-a-demo-dispatch --notify
```

La tarea debe reservar 1 und por FEFO, idealmente del lote producido en vivo. Jobana, ya en `despacho`, confirma por ID corto y repite para demostrar idempotencia.

## Escenario 2: In-and-out

### 1. Mostrar modalidad

1. Buscar `zenova ashwa` o `00276-PTZNASHWA`.
2. Mostrar modalidad `IO`, unidad `und`, lote y ausencia de BOM.
3. Explicar que llega terminado, se almacena y se despacha; nunca crea OP.

### 2. Recibir cinco unidades

Camino principal: mostrar la carga documental completa. La OC precargada ID 9 queda como respaldo y no se usa mientras funcione este recorrido.

1. Enviar por WhatsApp `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-IO.pdf` con el texto: `Carga esta orden de compra de producto in-and-out para recepcion.`
2. Verificar que el agente cree el borrador `DEMO-PRESENTACION-OC-IO` en `PENDIENTE_REVISION`, sin crear stock ni una recepcion.
3. Abrir `Recepciones > Ordenes de compra`, revisar el PDF recibido por WhatsApp y validar proveedor, SKU `00276-PTZNASHWA`, 5 und, lote `DEMO-PRESENTACION-IO-ZENOVA-001` y vencimiento `2027-11-29`.
4. Pulsar `Confirmar y crear OC`, anotar el ID corto como `<ID_IO>` y comprobar que quede `CARGADA`, con PDF asociado y sin modificar inventario.
5. Datana consulta recepciones y dice: `Prepara la recepcion ID <ID_IO>`. La seleccion tambien acepta errores previsibles de voz como `D<ID_IO>` cuando el ID aparece en la bandeja inmediata. La preparacion debe mostrar el lote documental `DEMO-PRESENTACION-IO-ZENOVA-001`, vencimiento `2027-11-29`, 5 und pendientes y ubicacion sugerida `B13`.
6. Reportar: `Para la recepcion ID <ID_IO> llegaron completas 5 unidades de Zenova Ashwagandha y estan disponibles en B13. El lote y el vencimiento coinciden con el PDF y la etiqueta fisica.`
7. Revisar el resumen con SKU, cantidad, lote proveedor, vencimiento y ubicacion; aun sin movimiento.
8. Confirmar: `Confirmo la recepcion ID <ID_IO>`.
9. Esperar la respuesta antes de reenviar. En el ensayo, el primer ciclo tardo cerca de 38 segundos; un segundo envio durante esa espera genero dos respuestas, aunque la idempotencia evito duplicar inventario.
10. Mostrar ingreso e historico. No debe aparecer BOM, consumo de MP ni OP.

Resultado del ensayo: `REC-OC-11-001` quedo completada y la OC ID `11` cerrada. Se creo una sola existencia de 5 und de `00276-PTZNASHWA` en `B13`, lote `DEMO-ENSAYO-FINAL-IO-ZENOVA-001`, vencimiento `2027-11-30`, y un solo movimiento de Kardex. BuilderBot recibio dos confirmaciones iguales con 34 segundos de diferencia y envio dos respuestas aceptadas por el proveedor; la segunda indico que la OC ya estaba recibida y no modifico inventario.

Los dos paquetes completos pueden regenerarse sin precargar OC ni modificar la base:

```powershell
node scripts\qa\prepare-repeatable-demo.js --run=ENSAYO-FINAL --date=2026-09-02 --io-expiry=2027-11-30 --pdf-only --only=all
node scripts\qa\create-demo-3q-exit-pdf.js --run=ENSAYO-FINAL --date=2026-09-02
node scripts\qa\prepare-repeatable-demo.js --run=PRESENTACION --date=2026-09-03 --io-expiry=2027-11-29 --pdf-only --only=all
node scripts\qa\create-demo-3q-exit-pdf.js --run=PRESENTACION --date=2026-09-03
```

La OC precargada ID 6 y la OC reservada ID 9 se conservan como contingencia si el servicio de lectura documental no responde.

El lote se lee de la etiqueta o documento fisico del proveedor. El WMS no debe adivinar ni generar el lote de un producto que exige lote externo.

### 3. Preparar y confirmar despacho IO

```powershell
node scripts\qa\prepare-demo-dispatch.js --scenario=io --run=PRESENTACION
node scripts\qa\prepare-demo-dispatch.js --scenario=io --run=PRESENTACION --apply --yes-i-understand-this-creates-a-demo-dispatch --notify
```

1. Jobana en `despacho` pregunta: `Que despachos pendientes hay?`
2. Confirma el ID de `FV-DEMO-PRESENTACION-IO-001`.
3. Debe salir 2 und y quedar 3 und del lote recibido.
4. Repetir sin segundo descuento.
5. Consultar: `Muestrame la trazabilidad del lote DEMO-PRESENTACION-IO-ZENOVA-001`.
6. Mostrar OC/PDF, recepcion, lote, ubicacion, factura sintetica, despacho, cliente y saldo; sin produccion.

Estado del ensayo: se creo el despacho ID `49`, `DSP-SIIGO-FV-DEMO-IO-001`, asociado a la factura sintetica `FV-DEMO-IO-001`. Quedaron reservadas 2 und del lote `DEMO-ENSAYO-FINAL-IO-ZENOVA-001` en `B13`, sin descuento hasta la confirmacion. La notificacion proactiva no se emitio desde el preparador local porque ese proceso no carga las credenciales de BuilderBot; la tarea si aparece al consultar los despachos pendientes por WhatsApp.

Resultado del ensayo: Jobana confirmo el despacho ID `49` por WhatsApp. El despacho quedo `despachado`, `cantidad_des` en 2 und y el lote `DEMO-ENSAYO-FINAL-IO-ZENOVA-001` paso de 5 a 3 und, con reserva 0. Se creo un unico movimiento `DESPACHO` de -2, saldo posterior 3 y referencia `factura-siigo:FV-DEMO-IO-001`.

La consulta de trazabilidad del lote tambien fue validada por WhatsApp. Mostro hacia atras la OC `DEMO-ENSAYO-FINAL-OC-IO`, la recepcion `REC-OC-11-001`, el proveedor, 5 und ingresadas y la ubicacion `B13`; hacia adelante mostro la factura sintetica `FV-DEMO-IO-001`, el despacho, el cliente, 2 und despachadas y saldo 3. La ausencia de BOM y OP es correcta para modalidad In-and-Out.

## Escenario 3: maquila 3Q

La demostracion comienza cuando Sofi prepara y envia materiales a 3Q, aun si la OC del producto terminado todavia no fue cargada. El recorrido visible es: remision -> reserva FEFO -> salida fisica -> custodia externa `EN_3Q_PENDIENTE_OC` -> cargar/revisar OC -> vincular OC -> recepcion parcial -> recepcion final -> trazabilidad -> despacho al cliente. El WMS permite adelantar la operacion fisica, pero bloquea la recepcion del terminado hasta validar una OC con PDF, el mismo maquilador, el producto y una cantidad suficiente.

### 1. Preparar la remision sin OC

Prerequisito: la OC de insumos `DEMO-PRESENTACION-OC-INSUMOS` debe estar recibida y las etiquetas Booster disponibles.

1. Enviar por WhatsApp `output/pdf/demo-presentacion/DEMO-PRESENTACION-SALIDA-3Q.pdf` con el texto: `Registra esta salida de materiales hacia 3Q como borrador.`
2. Verificar en `Maquila 3Q > Documentos leidos` la referencia `DEMO-PRESENTACION-SALIDA-3Q`, cuatro materiales y 16 unidades. El PDF por si solo no reserva ni descuenta inventario.
3. Abrir `Maquila 3Q > Nueva remision`.
4. Dejar `OC del producto esperado` en `Pendiente de cargar o vincular`.
5. Elegir `3Q - PROVEEDOR DEMO`, SKU `00105-PTBOS60` y cantidad 4.
6. Pulsar `Preparar remision y picking` y guardar el codigo `MQ-3Q-...` y la remision `REM-3Q-...`.
7. Cotejar el documento con el BOM `ENVIO`: 4 tapas, 4 tarros, 4 etiquetas Booster y 4 liners.
8. Destacar que la remision preparada reserva por FEFO, no descuenta; no se envian gomas y 3Q no es una bodega interna.

### 2. Enviar materiales

1. Preparar la remision principal.
2. Revisar cantidades, lotes FEFO y ubicaciones. El borrador reserva, pero no descuenta.
3. Confirmar la salida en dashboard.
4. Verificar un solo movimiento por material, menor stock local, reservas liberadas, remision confirmada y orden `EN_3Q_PENDIENTE_OC`.
5. Repetir la confirmacion: no debe descontar nuevamente.

El WMS solo conserva custodia externa documental: que se envio, cuando, por quien y para que orden. No inventa bodega, ubicacion ni stock interno de 3Q.

### 3. Cargar y vincular la OC esperada

1. Enviar por WhatsApp `output/pdf/demo-presentacion/DEMO-PRESENTACION-OC-3Q.pdf` con el texto: `Carga esta orden de compra del producto terminado esperado desde 3Q.`
2. Verificar el borrador `DEMO-PRESENTACION-OC-3Q` y revisarlo en `Recepciones > Ordenes de compra`.
3. Confirmar y crear la OC; anotar el ID asignado como `<ID_OC_3Q>`.
4. Antes de vincular, intentar iniciar la recepcion: debe bloquearla e indicar que falta la OC.
5. Abrir `Maquila 3Q > Vincular OC`.
6. Seleccionar la orden `MQ-3Q-...` y la OC `<ID_OC_3Q>`.
7. Pulsar `Validar y vincular OC`.
8. Verificar que la orden pasa a `EN_3Q`. La validacion exige PDF, mismo maquilador, mismo PT y cantidad de OC mayor o igual al objetivo.

### 4. Recibir parcial de tres

Prerequisito: Datana en `recepcion_cierre`.

1. Abrir `Recepciones > Confirmar recepcion > Producto desde 3Q`.
2. Seleccionar la orden y escribir `3` como cantidad de esta entrega.
3. Iniciar recepcion fisica.
4. Registrar `DISPONIBLE`, 3 und, lote `3Q-PRESENTACION-BOOSTER-A`, ubicacion `C8`, vencimiento `2027-12-30`.
5. Aprobar.
6. Verificar estado `RECIBIDA_PARCIAL`, acumulado 3 y saldo 1. OC y orden siguen abiertas.

### 5. Completar con una unidad

1. Volver a `Producto desde 3Q`; debe mostrar saldo 1.
2. Preparar 1 und.
3. Registrar lote `3Q-PRESENTACION-BOOSTER-B`, ubicacion `C8`, vencimiento `2027-12-30`, `DISPONIBLE`.
4. Aprobar y verificar 4 und acumuladas y orden `COMPLETADA`.

Se usan lotes distintos porque hoy una segunda recepcion no se agrega a un lote ya existente. Esto es una pregunta para el cliente, no una regla definitiva.

### 6. Preparar y confirmar despacho PT

Solo despues de completar la recepcion:

```powershell
node scripts\qa\prepare-demo-dispatch.js --scenario=outsourcing --run=PRESENTACION
node scripts\qa\prepare-demo-dispatch.js --scenario=outsourcing --run=PRESENTACION --apply --yes-i-understand-this-creates-a-demo-dispatch --notify
```

1. Jobana en `despacho` consulta pendientes.
2. Confirma el ID de `FV-DEMO-PRESENTACION-3Q-001`.
3. Deben salir 2 und con lote y cliente final, conservando el enlace a materiales enviados a 3Q.
4. Repetir sin segundo movimiento.
5. Consultar trazabilidad de `3Q-PRESENTACION-BOOSTER-A`.

### Alcance actual de WhatsApp en 3Q

El flujo operativo 3Q se demuestra en dashboard. BuilderBot puede leer un PDF de salida como borrador documental, pero hoy no convierte automaticamente ese borrador en una remision operativa, no confirma la salida, no vincula la OC y no recibe el terminado. Tampoco hay notificaciones 3Q acordadas. No presentar esas capacidades como terminadas.

## Bloque final de despachos

1. Completar primero los lotes PR, IO y PT.
2. Cambiar Jobana una sola vez de `alistador` a `despacho`.
3. Ejecutar dry-run y luego aplicar cada factura sintetica, una por una.
4. Consultar y confirmar cada tarea antes de preparar la siguiente para no confundir IDs.
5. Verificar Kardex, saldo, reserva cero, cliente y trazabilidad.
6. Restaurar Jobana a `alistador`. Datana permanece en `recepcion_cierre`.

## Controles a demostrar

- Un PDF crea expectativa revisable, no inventario.
- Cuarentena y rechazo no aumentan disponibilidad.
- `PR` pasa por OP; `IO` no pasa por OP; `PT` pasa por custodia 3Q.
- Los alias ayudan, pero una ambiguedad falla cerrada.
- FEFO propone lote y ubicacion; el operario confirma la realidad fisica.
- Preparar o reservar no equivale a descontar.
- Cada confirmacion exige permiso e intencion explicita.
- Un reintento no duplica Kardex, stock, recepcion, produccion ni despacho.
- Las facturas del demo son sinteticas y no llaman a Siigo.
- La trazabilidad termina en el cliente final.

## Preguntas para el cliente

### Recepciones

1. Cuando todo lo recibido coincide con la OC, ¿prefieren confirmar directamente el resumen preparado o volver a declarar cada SKU, cantidad y ubicacion?
2. ¿La validacion detallada debe ser obligatoria solamente cuando existan diferencias, productos en cuarentena, rechazos o varias ubicaciones?
3. ¿Como capturan normalmente el lote del proveedor: PDF, etiqueta, codigo de barras, fotografia o digitacion? La voz puede usarse como apoyo, pero el ensayo mostro que un solo caracter mal transcrito puede alterar la trazabilidad.

### Produccion propia

1. Cuando una OP atiende un pedido, ¿debe estar siempre vinculada a una OC del cliente? Si es asi, ¿se carga por dashboard, WhatsApp o ambos?
2. Si el cierre tiene menos conformes que el plan, ¿se cierra corto, se mantiene abierto para reponer o Sofi elige?
3. Si se dana una unidad terminada, ¿sus componentes se descartan, recuperan o reprocesan? ¿Quien decide?
4. ¿Una merma de proceso se notifica de inmediato a Sofi/Nelly o basta la conciliacion del cierre?

### In-and-out

5. ¿Todos los productos In-and-Out llegan con un lote asignado por el proveedor? Si alguno puede llegar sin lote, ¿debe el WMS crear una partida interna o bloquear la recepcion?
6. Para el arranque se usara OC en PDF. A futuro, ¿quieren adjuntar tambien factura o remision del proveedor como evidencia?
7. ¿Quien autoriza diferencias de cantidad, lote, vencimiento o condicion contra la OC?

### Maquila 3Q

8. ¿La OC a 3Q siempre existe antes de enviar los materiales o puede crearse/cargarse despues de la remision? Si puede ser posterior, ¿que autorizacion o referencia interna soporta el envio inicial?
9. ¿Una OC a 3Q puede tener entregas parciales con el mismo lote final?
10. ¿3Q puede entregar varios lotes del mismo PT en una sola entrega?
11. Ademas de la OC, ¿que documento reciben al retornar el PT y cual debe conservar el WMS?
12. ¿La remision de salida debe ser obligatoria antes de descontar, quien la firma y quien figura como receptor?
13. ¿Quienes reciben notificaciones al crear, enviar, recibir parcialmente, completar o detectar diferencias?
14. ¿Pueden volver materiales no utilizados desde 3Q? ¿Como se clasifican?
15. Si 3Q reporta PT danado, ¿Sofi envia el BOM completo de reposicion o elige componentes y cantidades?
16. Si 3Q entrega mas que el objetivo, ¿se rechaza, queda en cuarentena o se acepta con autorizacion?
17. ¿Las acciones 3Q deben habilitarse por WhatsApp o mantenerse en dashboard?

### Fuera de esta demo

18. Confirmar la politica de consumo de cajas y excepciones. Esta capacidad esta pausada y no participa en los recorridos.

## Verificacion tecnica previa

1. `node scripts\qa\prepare-demo-e2e.js`
2. `node scripts\qa\prepare-demo-e2e.js --smoke-reception`
3. Ejecutar suite completa y build.
4. Verificar las tres OC y las modalidades `Compra directa` / `Producto desde 3Q`.
5. Confirmar que aun no existen `FV-DEMO-PRESENTACION-PR-001`, `FV-DEMO-PRESENTACION-IO-001` ni `FV-DEMO-PRESENTACION-3Q-001`.
6. Abrir las paginas requeridas y conservar la OP 67 como respaldo visual.
7. Verificar que las referencias `DEMO-PRESENTACION-OC-INSUMOS`, `DEMO-PRESENTACION-OC-IO`, `DEMO-PRESENTACION-SALIDA-3Q` y `DEMO-PRESENTACION-OC-3Q` no se hayan consumido en una corrida anterior.

## Contingencia

- Si WhatsApp demora, continuar desde dashboard y mostrar luego el historial.
- No reenviar una confirmacion mientras siga procesandose; consultar el dashboard antes de reintentar una operacion que modifica inventario.
- Si una frase no enruta, consultar la bandeja y usar el ID corto.
- Si un escenario ya fue confirmado en ensayo, mostrarlo como evidencia o crear una nueva referencia; no reciclarlo.
- No limpiar datos hasta terminar la presentacion.
- No depender de Siigo, cron ni documentos reales.

## Bitacora del ensayo final

| Entidad | ID/codigo | Estado final | Evidencia revisada |
|---|---|---|---|
| Recepcion insumos |  |  |  |
| OP propia |  |  |  |
| Lote PT propio |  |  |  |
| Recepcion IO | OC ID `11` / borrador `REC-OC-11-001` | `PREPARADA`, pendiente de resumen y confirmacion | PDF extraido por WhatsApp; consulta de bandeja y preparacion por Datana correctas; 1 item, 5 und, ubicacion sugerida B13 |
| Lote IO | `DEMO-IO-ZENOVA-001` |  |  |
| Orden 3Q |  |  |  |
| Remision 3Q |  |  |  |
| Recepcion parcial 3Q |  |  |  |
| Recepcion final 3Q |  |  |  |
| Despacho PR |  |  |  |
| Despacho IO |  |  |  |
| Despacho PT |  |  |  |

## Hoja de control de la presentacion

Completar estos valores en vivo. Esta tabla evita reutilizar por error los ID del ensayo.

| Entidad | Referencia fija | ID/codigo asignado en vivo | Estado esperado |
|---|---|---|---|
| OC de insumos | `DEMO-PRESENTACION-OC-INSUMOS` |  | `CARGADA`, luego `RECIBIDA` |
| Recepcion de insumos | Derivada de la OC anterior |  | `COMPLETADA` |
| OP propia | `00102-PTASH60`, 3 und |  | `CERRADA` |
| Lote PT propio | Generado por WMS |  | 3 und disponibles antes del despacho |
| OC In-and-Out | `DEMO-PRESENTACION-OC-IO` |  | `CARGADA`, luego `RECIBIDA` |
| Recepcion IO | Lote `DEMO-PRESENTACION-IO-ZENOVA-001` |  | 5 und en `B13` |
| Documento de salida 3Q | `DEMO-PRESENTACION-SALIDA-3Q` |  | `PENDIENTE_REVISION` |
| Orden / remision 3Q | `00105-PTBOS60`, 4 und |  | `EN_3Q_PENDIENTE_OC`, luego `EN_3Q` |
| OC 3Q | `DEMO-PRESENTACION-OC-3Q` |  | Vinculada a la orden 3Q |
| Recepcion parcial 3Q | Lote `3Q-PRESENTACION-BOOSTER-A` |  | 3 und; orden `RECIBIDA_PARCIAL` |
| Recepcion final 3Q | Lote `3Q-PRESENTACION-BOOSTER-B` |  | 1 und; orden `COMPLETADA` |
| Despacho PR | `FV-DEMO-PRESENTACION-PR-001` |  | Confirmado una vez |
| Despacho IO | `FV-DEMO-PRESENTACION-IO-001` |  | Confirmado una vez |
| Despacho PT | `FV-DEMO-PRESENTACION-3Q-001` |  | Confirmado una vez |

## Cierre sugerido

El sistema separa expectativa, realidad fisica y contabilidad. Asi puede recibir, producir, tercerizar y despachar con controles distintos, sin perder trazabilidad ni depender de que el operario recuerde codigos tecnicos.
