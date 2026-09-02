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
| Linea operativa | Datana, linea `3125031367`; su rol rota durante la demo. |
| Linea del agente | `573173292904`. |
| OC de insumos | ID `4`, `DEMO-20260902-OC-INSUMOS`, abierta y con PDF. |
| OC In-and-out | ID `6`, `DEMO-20260902-DOC-IO-001`, abierta y con PDF. |
| OC de 3Q | ID `7`, `DEMO-20260902-OC-3Q-001`, abierta y con PDF. |
| PDF 3Q | `output/pdf/DEMO-20260902-OC-3Q-001.pdf`. |
| Produccion propia | `00102-PTASH60`, Ashwagandha x 60, objetivo 3 und. |
| In-and-out | `00276-PTZNASHWA`, Zenova Ashwagandha, recepcion de 5 und. |
| Maquila 3Q | `00105-PTBOS60`, Booster x 60, objetivo 4 und. |
| Stock | La OC ID 4 completa los insumos de produccion y 3Q. No se requiere inventario arbitrario adicional. |
| Siigo | Fuera de la demo. Los despachos nacen de facturas sinteticas locales procesadas por el importador determinista. |

La OC ID 4 debe recibirse primero. Aporta, entre otros, 10 etiquetas Booster `00018-ETBOS60`, cuyo saldo disponible inicial es cero.

## Orden y roles

| Bloque | Rol de Datana | Acciones |
|---|---|---|
| 1. Entradas | `recepcion_cierre` | Recibir OC de insumos ID 4 e IO ID 6. |
| 2. Alistamiento | `alistador` | Confirmar materiales e inicio de la OP propia. |
| 3. Cierres y 3Q | `recepcion_cierre` | Cerrar la OP y recibir dos entregas de 3Q. |
| 4. Salidas | `despacho` | Confirmar los despachos PR, IO y PT. |
| 5. Restauracion | `recepcion_cierre` | Dejar la linea en su rol base. |

Comando de apoyo, fuera de la vista del cliente:

```powershell
node scripts\qa\set-demo-user-role.js --phone=3125031367 --role=<ROL> --actor-phone=3174442659
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

1. Preguntar en WhatsApp: `Que recepciones pendientes hay?`
2. Decir: `Prepara la recepcion ID 4`.
3. Reportar con alias:

   `Para la recepcion ID 4 llegaron completos: 12 tapas blancas 60 disponibles en A8; 12 tarros 60 disponibles en A11; 10 etiquetas ashwa 60 disponibles en A1; 12 liners 60 disponibles en A14; 2000 gramos de gomas ashwa disponibles en B16, lote DEMO-GOMAS-E2E-001, vencen el 15 de septiembre de 2026; y 10 etiquetas booster 60 disponibles en A1.`

4. Revisar el resumen: seis productos, cantidades, condiciones y ubicaciones. Solo las gomas requieren lote del proveedor.
5. Confirmar: `Confirmo la recepcion ID 4`.
6. Repetir la confirmacion. No debe duplicar stock ni Kardex.
7. Mostrar OC, PDF, recepcion, diferencias y movimientos.

El vencimiento corto es sintetico y deliberado: permite demostrar FEFO y que el PT hereda el vencimiento de las gomas consumidas.

### 2. Liberar e iniciar produccion

1. Juan dice: `Vamos a producir tres tarros de ashwagandha 60`.
2. El agente debe preguntar el destino antes de crear la orden.
3. Responder: `Para stock de seguridad`.
4. Verificar SKU y nombre, cantidad interpretada 3 und, destino, BOM, FEFO, ubicaciones, ID corto y codigo OP.
5. Confirmar que Datana recibe el mensaje de alistamiento.
6. Cambiar Datana a `alistador`.
7. Datana dice: `Ya aliste los materiales de la orden ID <ID_OP>`.
8. Verificar `EN_PROCESO` y un solo descuento de cada material.

| Evento | Destinatario | Contenido esperado |
|---|---|---|
| OP liberada | Alistador | OP, PT, cantidad, destino, BOM, lotes FEFO, ubicaciones e instruccion. |
| Materiales confirmados | Alistador | OP en proceso y lotes entregados. |
| Produccion iniciada | Sofi/admin y Nelly | OP, PT, plan, destino, actor, fecha, hora, materiales y estado. |

### 3. Cerrar produccion

El recorrido principal usa 3 conformes y 0 merma. La OP 67 cerrada queda como evidencia de merma si el cliente desea verla.

1. Cambiar Datana a `recepcion_cierre`.
2. Decir: `Cerramos la orden ID <ID_OP> con 3 unidades conformes y cero merma. Dejarlas en C2.`
3. El WMS genera el lote; el usuario no lo dicta.
4. El vencimiento esperado es `2026-09-15`, heredado de las gomas.
5. Juan debe recibir plan, conformes, merma, lote PT, ubicacion, vencimiento, actor y conciliacion.
6. Repetir el cierre: debe informar que ya estaba cerrada y no modificar inventario.
7. Consultar la trazabilidad del lote PT.

`Neto entregado` es lo que salio del disponible hacia produccion; `merma de proceso` es la perdida documentada; `uso productivo estimado` es neto menos merma. Un sobrante fisico debe devolverse antes del cierre para volver a estar disponible.

### 4. Preparar despacho PR

Ejecutar despues del cierre y antes del bloque final de despachos:

```powershell
node scripts\qa\prepare-demo-dispatch.js --scenario=own
node scripts\qa\prepare-demo-dispatch.js --scenario=own --apply --yes-i-understand-this-creates-a-demo-dispatch --notify
```

La tarea debe reservar 1 und por FEFO, idealmente del lote producido en vivo. Datana, ya en `despacho`, confirma por ID corto y repite para demostrar idempotencia.

## Escenario 2: In-and-out

### 1. Mostrar modalidad

1. Buscar `zenova ashwa` o `00276-PTZNASHWA`.
2. Mostrar modalidad `IO`, unidad `und`, lote y ausencia de BOM.
3. Explicar que llega terminado, se almacena y se despacha; nunca crea OP.

### 2. Recibir cinco unidades

Ejecutar en el primer bloque con Datana en `recepcion_cierre`.

1. Consultar recepciones y preparar ID 6.
2. Reportar: `Para la recepcion ID 6 llegaron completas 5 unidades de Zenova Ashwagandha, lote DEMO-IO-ZENOVA-001, vencen el 30 de noviembre de 2027 y estan disponibles en B13.`
3. Revisar el resumen con SKU, cantidad, lote proveedor, vencimiento y ubicacion; aun sin movimiento.
4. Confirmar: `Confirmo la recepcion ID 6`.
5. Repetir y comprobar idempotencia.
6. Mostrar ingreso e historico. No debe aparecer BOM, consumo de MP ni OP.

El lote se lee de la etiqueta o documento fisico del proveedor. El WMS no debe adivinar ni generar el lote de un producto que exige lote externo.

### 3. Preparar y confirmar despacho IO

```powershell
node scripts\qa\prepare-demo-dispatch.js --scenario=io
node scripts\qa\prepare-demo-dispatch.js --scenario=io --apply --yes-i-understand-this-creates-a-demo-dispatch --notify
```

1. Datana en `despacho` pregunta: `Que despachos pendientes hay?`
2. Confirma el ID de `FV-DEMO-IO-001`.
3. Debe salir 2 und y quedar 3 und del lote recibido.
4. Repetir sin segundo descuento.
5. Consultar: `Muestrame la trazabilidad del lote DEMO-IO-ZENOVA-001`.
6. Mostrar OC/PDF, recepcion, lote, ubicacion, factura sintetica, despacho, cliente y saldo; sin produccion.

## Escenario 3: maquila 3Q

### 1. Crear orden

Prerequisito: OC ID 4 recibida y etiquetas Booster disponibles.

1. Mostrar OC ID 7 `DEMO-20260902-OC-3Q-001` y descargar su PDF.
2. Abrir `Maquila 3Q > Nueva orden`.
3. Elegir OC ID 7, `00105-PTBOS60` y cantidad 4.
4. Crear la orden y guardar su ID/codigo.
5. Mostrar BOM `ENVIO`: 4 tapas, 4 tarros, 4 etiquetas Booster y 4 liners.
6. Destacar que no se envian gomas y que 3Q no es una bodega interna.

### 2. Enviar materiales

1. Preparar la remision principal.
2. Revisar cantidades, lotes FEFO y ubicaciones. El borrador reserva, pero no descuenta.
3. Confirmar la salida en dashboard.
4. Verificar un solo movimiento por material, menor stock local, reservas liberadas, remision confirmada y orden `EN_3Q`.
5. Repetir la confirmacion: no debe descontar nuevamente.

El WMS solo conserva custodia externa documental: que se envio, cuando, por quien y para que orden. No inventa bodega, ubicacion ni stock interno de 3Q.

### 3. Recibir parcial de tres

Prerequisito: Datana en `recepcion_cierre`.

1. Abrir `Recepciones > Confirmar recepcion > Producto desde 3Q`.
2. Seleccionar la orden y escribir `3` como cantidad de esta entrega.
3. Iniciar recepcion fisica.
4. Registrar `DISPONIBLE`, 3 und, lote `3Q-DEMO-BOOSTER-A`, ubicacion `C8`, vencimiento `2027-12-31`.
5. Aprobar.
6. Verificar estado `RECIBIDA_PARCIAL`, acumulado 3 y saldo 1. OC y orden siguen abiertas.

### 4. Completar con una unidad

1. Volver a `Producto desde 3Q`; debe mostrar saldo 1.
2. Preparar 1 und.
3. Registrar lote `3Q-DEMO-BOOSTER-B`, ubicacion `C8`, vencimiento `2027-12-31`, `DISPONIBLE`.
4. Aprobar y verificar 4 und acumuladas y orden `COMPLETADA`.

Se usan lotes distintos porque hoy una segunda recepcion no se agrega a un lote ya existente. Esto es una pregunta para el cliente, no una regla definitiva.

### 5. Preparar y confirmar despacho PT

Solo despues de completar la recepcion:

```powershell
node scripts\qa\prepare-demo-dispatch.js --scenario=outsourcing
node scripts\qa\prepare-demo-dispatch.js --scenario=outsourcing --apply --yes-i-understand-this-creates-a-demo-dispatch --notify
```

1. Datana en `despacho` consulta pendientes.
2. Confirma el ID de `FV-DEMO-3Q-001`.
3. Deben salir 2 und con lote y cliente final, conservando el enlace a materiales enviados a 3Q.
4. Repetir sin segundo movimiento.
5. Consultar trazabilidad de `3Q-DEMO-BOOSTER-A`.

### Alcance actual de WhatsApp en 3Q

El flujo operativo 3Q se demuestra en dashboard. BuilderBot puede leer un PDF de salida como borrador, pero hoy no crea, confirma ni recibe una orden 3Q operativa y no vincula automaticamente ese borrador con una remision WMS. Tampoco hay notificaciones 3Q acordadas. No presentar esas capacidades como terminadas.

## Bloque final de despachos

1. Completar primero los lotes PR, IO y PT.
2. Cambiar Datana una sola vez a `despacho`.
3. Ejecutar dry-run y luego aplicar cada factura sintetica, una por una.
4. Consultar y confirmar cada tarea antes de preparar la siguiente para no confundir IDs.
5. Verificar Kardex, saldo, reserva cero, cliente y trazabilidad.
6. Restaurar Datana a `recepcion_cierre`.

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

### Produccion propia

1. Cuando una OP atiende un pedido, ¿debe estar siempre vinculada a una OC del cliente? Si es asi, ¿se carga por dashboard, WhatsApp o ambos?
2. Si el cierre tiene menos conformes que el plan, ¿se cierra corto, se mantiene abierto para reponer o Sofi elige?
3. Si se dana una unidad terminada, ¿sus componentes se descartan, recuperan o reprocesan? ¿Quien decide?
4. ¿Una merma de proceso se notifica de inmediato a Sofi/Nelly o basta la conciliacion del cierre?

### In-and-out

5. Para el arranque se usara OC en PDF. A futuro, ¿quieren adjuntar tambien factura o remision del proveedor como evidencia?
6. ¿Quien autoriza diferencias de cantidad, lote, vencimiento o condicion contra la OC?

### Maquila 3Q

7. ¿Una OC a 3Q puede tener entregas parciales con el mismo lote final?
8. ¿3Q puede entregar varios lotes del mismo PT en una sola entrega?
9. Ademas de la OC, ¿que documento reciben al retornar el PT y cual debe conservar el WMS?
10. ¿La remision de salida debe ser obligatoria antes de descontar, quien la firma y quien figura como receptor?
11. ¿Quienes reciben notificaciones al crear, enviar, recibir parcialmente, completar o detectar diferencias?
12. ¿Pueden volver materiales no utilizados desde 3Q? ¿Como se clasifican?
13. Si 3Q reporta PT danado, ¿Sofi envia el BOM completo de reposicion o elige componentes y cantidades?
14. Si 3Q entrega mas que el objetivo, ¿se rechaza, queda en cuarentena o se acepta con autorizacion?
15. ¿Las acciones 3Q deben habilitarse por WhatsApp o mantenerse en dashboard?

### Fuera de esta demo

16. Confirmar la politica de consumo de cajas y excepciones. Esta capacidad esta pausada y no participa en los recorridos.

## Verificacion tecnica previa

1. `node scripts\qa\prepare-demo-e2e.js`
2. `node scripts\qa\prepare-demo-e2e.js --smoke-reception`
3. Ejecutar suite completa y build.
4. Verificar las tres OC y las modalidades `Compra directa` / `Producto desde 3Q`.
5. Confirmar que aun no existen `FV-DEMO-PR-001`, `FV-DEMO-IO-001` ni `FV-DEMO-3Q-001`.
6. Abrir las paginas requeridas y conservar la OP 67 como respaldo visual.

## Contingencia

- Si WhatsApp demora, continuar desde dashboard y mostrar luego el historial.
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
| Recepcion IO |  |  |  |
| Lote IO | `DEMO-IO-ZENOVA-001` |  |  |
| Orden 3Q |  |  |  |
| Remision 3Q |  |  |  |
| Recepcion parcial 3Q |  |  |  |
| Recepcion final 3Q |  |  |  |
| Despacho PR |  |  |  |
| Despacho IO |  |  |  |
| Despacho PT |  |  |  |

## Cierre sugerido

El sistema separa expectativa, realidad fisica y contabilidad. Asi puede recibir, producir, tercerizar y despachar con controles distintos, sin perder trazabilidad ni depender de que el operario recuerde codigos tecnicos.
