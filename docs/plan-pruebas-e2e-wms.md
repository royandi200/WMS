# Bateria de pruebas E2E del WMS

Actualizado: 2026-08-04

## Objetivo

Validar de punta a punta BuilderBot Cloud, API en Vercel, MySQL, dashboard y Siigo sandbox. Cada operacion debe comprobar respuesta al usuario, autorizacion por rol, transicion de estado, inventario, lote, ubicacion, kardex, trazabilidad e idempotencia.

Esta bateria usa datos QA identificables y no elimina historia. No se deben reutilizar OC, OP, facturas, despachos o lotes existentes.

## Lineas y configuracion optimizada

Las lineas se suministran por variables locales y no se guardan completas en Git:

- `E2E_AGENT_PHONE`: numero exclusivo del agente BuilderBot; nunca recibe un rol operativo.
- `E2E_ADMIN_PHONE`: linea humana fija con rol `admin` durante toda la prueba.
- `E2E_ROTATING_PHONE`: linea humana que rota en este orden: `recepcion_cierre` -> `alistador` -> `recepcion_cierre` -> `despacho`.
- `admin@wms.co`: cuenta de dashboard que conserva rol `admin`.

La rotacion requiere tres cambios y termina restaurando el rol operativo previsto para cada etapa. Antes de cambiar roles se debe registrar en la bitacora el usuario, rol anterior, rol nuevo, responsable y `RUN_ID`.

## Identificador y evidencia

Definir `RUN_ID=E2E-AAAAMMDD-HHMM`. Usarlo en observaciones y referencias:

- OC: `OC-<RUN_ID>`
- factura de compra sandbox: `FC-<RUN_ID>`
- cliente o referencia: `CLIENTE-<RUN_ID>`
- pruebas Siigo compartidas: respetar `SIIGO_TEST_PREFIX`; no usar nombres comerciales del cliente.

Por cada caso guardar: hora, linea, rol, mensaje, respuesta, HTTP o log BBC, IDs creados, captura de dashboard y consulta DB antes/despues.

## Fase 0. Puerta de entrada

1. Desplegar el commit a probar y registrar SHA y deployment de Vercel.
2. Confirmar `GET /api/v1/health` en 200 y MySQL conectado.
3. Ejecutar `npm test`, build del frontend y auditoria de dependencias.
4. Ejecutar el preflight de solo lectura:

```powershell
$env:E2E_AGENT_PHONE='<linea-agente>'
$env:E2E_ADMIN_PHONE='<linea-admin>'
$env:E2E_ROTATING_PHONE='<linea-rotativa>'
npm.cmd run test:e2e:preflight
```

5. Confirmar flags conservadores: despacho parcial, division de linea, recepcion manual y despacho directo desactivados; OC obligatoria para recepcion Siigo.
6. Mantener `ENABLE_WORKFLOW_NOTIFICATIONS=false` hasta la fase de mensajeria controlada.
7. Tomar snapshot DB de usuarios/roles, stock, reservas, OP abiertas, recepciones pendientes, despachos pendientes y cola de notificaciones.

Resultado obligatorio: cero stock negativo, cero reserva negativa, cero reserva superior al stock y las tres lineas con identidades distintas.

## Fase 1. Autenticacion, dashboard y RBAC

| Caso | Ejecucion | Resultado esperado |
|---|---|---|
| Login valido | Ingresar al dashboard como Admin | Token valido, nombre/rol correctos y navegacion habilitada |
| Login invalido | Un unico intento con clave incorrecta | 401 generico, sin filtrar si el correo existe |
| Sesion vencida | Probar token vencido en una ruta privada | 401 y salida controlada al login |
| Rol Nelly | Linea rotativa como `recepcion_cierre` intenta confirmar materiales | Denegado; no cambia OP, stock ni reserva |
| Rol Alistador | En su fase intenta cerrar una OP | Denegado; no crea lote PT ni merma |
| Rol Despacho | En su fase intenta liberar produccion | Denegado; no crea OP |
| Despacho directo | `POST /api/v1/dispatch` o boton heredado sin factura Siigo | 409; no descuenta stock ni crea despacho |
| Recepcion manual | Intento sin OC/factura Siigo | Rechazado por flag; no crea stock |

Revisar en dashboard: Inicio, Inventario (cinco vistas), Productos y filtro Tipo, Produccion, Mermas, Recepciones, Despachos, Devoluciones, Kardex, Aprobaciones, Usuarios, Logs webhook y Notificaciones.

Compatibilidad de aprobaciones heredadas: usar solamente una `REQ` nueva marcada con `<RUN_ID>`, nunca una de las solicitudes antiguas. Aprobarla una vez por WhatsApp y verificar usuario, fecha/hora y resultado en dashboard; aprobarla de nuevo debe informar que ya fue decidida y no repetir la accion, el descuento, la reserva, la merma ni la notificacion. Repetir el mismo control desde dashboard sobre otra `REQ` QA nueva.

## Fase 2. Compra, OC y recepcion

Rol rotativo: `recepcion_cierre`.

1. Admin carga `OC-<RUN_ID>` con `00004-TPALB`, 5 unidades y proveedor sandbox permitido.
2. Crear en Siigo sandbox una factura de compra `FC-<RUN_ID>` que corresponda a la OC.
3. Esperar el polling o ejecutar la sincronizacion autorizada. La recepcion debe quedar pendiente y enlazada a OC y factura.
4. Verificar que antes de confirmar no exista aumento de stock.
5. Desde dashboard confirmar la recepcion con esta distribucion:

| Condicion | Cantidad | Lote | Ubicacion | Efecto disponible |
|---|---:|---|---|---:|
| Disponible | 3 | `<RUN_ID>-REC-OK` | `PPAL-A-1-01` | +3 |
| Cuarentena | 1 | `<RUN_ID>-REC-Q` | `CUAR-C-1-01` | 0 |
| Rechazado | 1 | `<RUN_ID>-REC-R` | sin ubicacion disponible | 0 |

6. Repetir la confirmacion: debe informar que ya fue completada y no duplicar stock, lotes, recepcion ni kardex.
7. Validar diferencias OC/factura/recibido, usuario aprobador, fecha/hora, lotes y estados en el historico de recepciones.

## Fase 3. Produccion completa

### 3.1 Liberacion por Sofi

Rol de linea admin: `admin`. Enviar:

> libera una orden para producir 3 unidades de 00102-PTASH60 para stock de seguridad. Referencia <RUN_ID>

Validar:

- Accion `LIBERAR_ORDEN_PRODUCCION` y una OP nueva, nunca una OP anterior.
- Estado liberado/aprobado y origen `STOCK_SEGURIDAD`.
- BOM completo con cantidades para 3 unidades.
- Reservas FEFO por lote y ubicacion; ningun lote vencido puede ser seleccionado.
- Stock fisico aun no descontado; solo aumenta `reservada`.
- Mensaje al alistador cuando las notificaciones se habiliten.

Repetir el mismo mensaje no debe crear una segunda ejecucion accidental. Si crea otra OP valida por intencion, el agente debe pedir confirmacion explicita antes de duplicarla.

### 3.2 Alistamiento e inicio

Cambiar la linea rotativa a `alistador`. Enviar:

> confirmo materiales e inicio de produccion de <OP_RUN>

Validar estado `EN_PROCESO`, consumo exacto de reservas, `produccion_materiales`, detalle por lote/ubicacion, movimientos y kardex. Repetir el mensaje: debe ser idempotente y no descontar otra vez.

Probar ajuste con el lote MP realmente seleccionado:

> entrega 0.25 adicional de 00051-MPASH, lote <LOTE_MP>, ubicacion <UBICACION_MP>, para <OP_RUN> por ajuste de proceso

> devuelve 0.10 de 00051-MPASH, lote <LOTE_MP>, ubicacion <UBICACION_MP>, de <OP_RUN> por sobrante de alistamiento

Validar salida neta adicional de 0.15, ubicacion de origen, cantidades entregadas/devueltas y kardex. Intentar devolver mas de lo consumido debe responder 409 y conservar saldos.

### 3.3 Cierre por Nelly

Cambiar la linea rotativa a `recepcion_cierre`. Enviar primero como audio y, si se requiere aislar reconocimiento, repetir como texto:

> cerramos produccion <OP_RUN> con 2 conformes y 1 merma por dano de empaque, dejar en PPAL-A-1-01, vence el 31 de diciembre de 2027

Validar:

- La misma frase conserva OP, conformes, merma, motivo, ubicacion y vencimiento.
- Estado `CERRADA`, 2 unidades PT disponibles y un unico lote de salida.
- Una merma de 1 ligada a la OP, SKU, motivo, usuario y hora.
- Comparacion plan 3 contra resultado 2 + merma 1.
- Consumo real de MP incluye el ajuste neto y permite calcular desviacion contra BOM.
- Repetir el cierre informa quien y cuando cerro; no crea otro lote, merma o kardex.

Prueba de contexto: enviar la orden completa, luego una correccion corta de motivo. El agente debe conservar la OP y cantidades del historial inmediato, sin volver al inicio del formulario.

## Fase 4. Factura Siigo y despacho

Cambiar la linea rotativa a `despacho`.

1. Antes de crear factura, enviar desde cualquier linea:

> despacha 1 unidad de 00102-PTASH60 para CLIENTE-<RUN_ID>

Debe explicar que primero debe existir factura Siigo y no crear reserva, REQ o despacho.

2. Crear factura de venta sandbox con el prefijo QA permitido, cliente QA y 1 unidad del producto sandbox homologado. No incluir nombres comerciales reales.
3. Desde la linea admin enviar:

> revisa Siigo y actualiza las facturas de venta

4. Validar tarea en `picking`, cliente final, factura, cantidad, reserva FEFO, lote y ubicacion visibles en WhatsApp y dashboard.
5. Con un rol distinto de `despacho`, intentar confirmar. Debe ser denegado sin mutaciones.
6. Desde la linea rotativa enviar:

> confirma el despacho de la factura <FV_RUN>

7. Validar estado `despachado`, cantidad despachada 1, stock y saldo del lote -1, reserva liberada/consumida, movimiento y kardex. La trazabilidad debe mostrar cliente final y factura.
8. Repetir la confirmacion. Debe indicar que ya fue despachada, con usuario y hora, y no volver a descontar.

Casos negativos: factura sin stock crea demanda pendiente pero no permite confirmar; factura anulada antes del despacho libera reserva; factura modificada o anulada despues del despacho crea novedad de conciliacion y no altera inventario automaticamente.

## Fase 5. Devoluciones y merma

Con rol `despacho`, registrar desde WhatsApp y luego una variante desde dashboard:

> registra devolucion de 1 unidad de 00102-PTASH60 del CLIENTE-<RUN_ID> en cuarentena

Validar devolucion, recepcion asociada, lote nuevo, cliente origen y estado `CUARENTENA`; no debe aumentar stock disponible.

Repetir con un registro `RECUPERABLE`: solo este estado suma stock disponible. `DESTRUCCION` y `CUARENTENA` quedan bloqueados. Comprobar historial de devoluciones, lotes, ubicacion/estado, movimientos y kardex.

Durante una OP activa probar:

> reporta merma de 0.25 de 00051-MPASH en <OP_RUN> por derrame controlado <RUN_ID>

Debe quedar ligada exactamente a una OP o lote, nunca a ambos, y aparecer en el historial de mermas. Una cantidad cero/negativa o sin motivo debe rechazarse sin mutacion.

## Fase 6. Consultas y trazabilidad

Enviar desde ambas lineas, sin cambiar datos:

1. `cuanto stock disponible hay de 00102-PTASH60 y en que lotes y ubicaciones`
2. `cuanto podemos fabricar de 00102-PTASH60`
3. `dame el estado de <OP_RUN> con materiales y desviaciones`
4. `dame la trazabilidad completa del lote <LOTE_PT_RUN>`
5. `dame la trazabilidad completa del lote <LOTE_MP>`
6. `que solicitudes o tareas pendientes hay; separalas por tipo y dame sus codigos`

La trazabilidad PT debe unir recepcion/origen de MP, BOM, OP, ajustes, merma, lote PT, factura, despacho, cantidades y cliente final. La consulta de un lote incluido en el primer mensaje no debe volver a pedirlo. Las respuestas no deben incluir JSON interno ni valores `undefined`.

## Fase 7. Notificaciones BuilderBot

Esta fase se ejecuta al final para evitar mensajes a usuarios historicos.

1. Guardar snapshot de roles, telefonos y `ENABLE_WORKFLOW_NOTIFICATIONS`.
2. Aislar temporalmente los destinatarios de los roles bajo prueba; no tocar la linea del agente.
3. Habilitar notificaciones y redesplegar.
4. Generar una nueva OP y una nueva tarea de despacho con `<RUN_ID>-NOTIFY`.
5. Confirmar en BBC: request aceptado, destinatario correcto, contenido sin JSON y un solo envio por evento.
6. Confirmar en `notificaciones_salida`: evento, destinatario enmascarado, estado, intentos y error nulo.
7. Reintentar el evento: no debe duplicar el mensaje por la clave idempotente.
8. Restaurar roles, telefonos y flag; redesplegar y verificar nuevamente.

## Fase 8. Dashboard y conciliacion cruzada

Buscar `<RUN_ID>` en cada modulo. Los totales del dashboard deben reconciliar con DB:

- Inicio: ordenes activas, recepciones, despachos, merma y pendientes relevantes.
- Inventario: producto, lote, bodega, ubicacion, disponible/reservado, vencimiento y estado.
- Produccion: OP, fecha/hora, plan, real, merma, fase, materiales y desviaciones.
- Recepciones: OC, factura, proveedor, esperado/recibido, diferencias y distribuciones.
- Despachos: factura, cliente, lote, ubicacion, facturado/reservado/despachado y estado.
- Devoluciones: alta desde dashboard e historial con estado.
- Mermas: historial sin error, filtros y enlace a OP/lote.
- Kardex y trazabilidad: mismo saldo y mismas referencias que las operaciones.
- Usuarios: roles finales correctos; el agente no figura como operario.
- Logs/Notificaciones: correlacion por hora, accion, resultado y `RUN_ID`.

## Criterios de cierre y rollback

La bateria aprueba solo si:

- No hay mutaciones duplicadas al repetir recepcion, inicio, cierre o despacho.
- Ningun usuario ejecuta una capacidad fuera de su rol.
- Cuarentena, rechazo, destruccion y merma no se vuelven stock disponible.
- FEFO excluye vencidos y cada salida conserva lote y ubicacion.
- Stock, reservas, lotes, movimientos, kardex y dashboard concilian.
- Las respuestas WhatsApp son legibles, sin JSON interno, `undefined` ni bucles.
- Siigo y WMS conservan el cliente final y la referencia contable.

Al finalizar: restaurar roles y flags desde el snapshot, dejar las transacciones QA etiquetadas, registrar cualquier reserva pendiente y ejecutar nuevamente preflight, tests y build. No borrar historia con SQL ni corregir saldos manualmente sin un movimiento de ajuste auditado.

## Riesgos de seguridad pendientes

- El webhook BuilderBot aun admite `kw=g0m@s` como autenticacion de respaldo; debe retirarse antes de produccion y exigir secreto o firma.
- El login no tiene limitacion de intentos; añadir rate limiting antes de exposicion productiva.
- El endpoint de salud publica mas detalle interno del necesario.
- Revisar TLS MySQL para exigir validacion de certificado.
- `react-router` reporta un advisory alto asociado a RSC Mode. La aplicacion usa `BrowserRouter` declarativo y no RSC, por lo que la ruta parece no alcanzable, pero debe actualizarse cuando exista una version corregida compatible.
