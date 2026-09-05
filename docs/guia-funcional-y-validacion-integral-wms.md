# Guia funcional y plan de validacion integral del WMS

Actualizado: 2026-09-02

Seguimiento de pruebas desde el 2026-09-04: [bitacora de resultados, novedades y pendientes](bitacora-pruebas-manuales-2026-09.md). Se actualiza al terminar cada prueba; la siguiente requiere aprobacion de Juan. Este enlace no actualiza por si solo la cobertura historica de esta guia.

## 1. Objetivo del documento

Este documento permite que un socio, responsable operativo o persona de QA entienda que hace el WMS y pueda validar sus funciones de forma ordenada. Cubre dashboard, WhatsApp, movimientos de inventario, trazabilidad, roles e integraciones.

El objetivo de la siguiente jornada no es solo comprobar que una pantalla abre o que el agente responde. Cada prueba debe confirmar cinco capas:

1. La persona correcta puede ejecutar la accion y las demas no.
2. La respuesta explica claramente que ocurrio.
3. El estado operativo cambia una sola vez.
4. Stock, reservas, lotes, ubicaciones, movimientos y Kardex concilian.
5. La trazabilidad permite reconstruir el origen y el destino del producto.

## 2. Como interpretar el estado

| Estado | Significado |
|---|---|
| `AUTOMATIZADO` | Existe una prueba repetible que valida reglas o contratos en codigo. No demuestra por si sola la experiencia real en WhatsApp o navegador. |
| `MANUAL VALIDADO` | El recorrido fue ejecutado por una persona contra el entorno de desarrollo y se comprobo su efecto. |
| `PARCIAL` | Una parte funciona, pero falta una variante, canal, excepcion o recorrido completo. |
| `PENDIENTE` | Esta implementado pero aun no tiene validacion suficiente, o requiere una decision de negocio. |
| `DESACTIVADO` | Existe estructura o codigo, pero no debe utilizarse hasta nueva autorizacion. |
| `FUERA DE ALCANCE` | No forma parte del comportamiento prometido actualmente. |

Implementado no significa validado. Una funcion puede estar `AUTOMATIZADO` y seguir `PENDIENTE` en audio, notificaciones o interfaz.

## 3. Evidencia tecnica vigente

- Suite local ejecutada el 2026-09-02: `172/172` pruebas aprobadas.
- Build de frontend ejecutado el 2026-09-02: Vite completo, `1530` modulos transformados.
- Las pruebas automatizadas cubren permisos, idempotencia, FEFO, lotes vencidos, recepciones, produccion, reposicion, 3Q, devoluciones, mermas, trazabilidad, documentos PDF y mapa de bodega.
- Estas cifras no sustituyen la validacion manual de BuilderBot, audios, red de WhatsApp, navegador, despliegue ni servicios externos.

## 4. Vista general del sistema

### 4.1 Matriz ejecutiva de cobertura

| Flujo o modulo | Automatizado | Validacion manual acumulada | Siguiente validacion |
|---|---|---|---|
| Login, navegacion y roles | Si | Acceso, cambios de rol y rechazos por permiso observados | Regresion completa por cada rol |
| OC PDF y recepcion directa | Si | Documento, borrador, resumen, confirmacion e idempotencia | Parcial, diferencias y cancelacion en una sola corrida |
| Produccion propia | Si | Liberacion, FEFO, inicio, merma, cierre, notificaciones e idempotencia | Reposicion completa y politica de cierre corto |
| In-and-Out | Si | OC, recepcion, despacho y trazabilidad E2E | Repetir con documento y lote nuevos |
| Maquila 3Q | Si | Salida, OC posterior, vinculacion y recepcion pendiente | Completar parcial, final, despacho y trazabilidad |
| Despachos | Si | Reserva, lote visible, confirmacion e idempotencia | Faltante, anulacion y evidencia Siigo del equipo integrador |
| Devoluciones | Si | Recuperable y cuarentena | Destruccion y exceso acumulado |
| Mermas | Si | Bodega y proceso | Notificaciones y errores negativos en una corrida nueva |
| Kardex y trazabilidad | Si | PR e IO | 3Q completo hasta cliente final |
| Notificaciones y logs | Si | Produccion y tarea de despacho | Matriz completa, error y reintento |
| Siigo | Parcial | Compras y ventas observadas en sandbox en pruebas anteriores | Validacion vigente y documentada por el responsable de integracion |
| Seguridad e idempotencia | Si | Reintentos de recepcion, produccion y despacho observados | Concurrencia y autenticacion reforzada antes de produccion |

Prioridad de la proxima sesion: cerrar Maquila 3Q, reposicion de produccion, devolucion para destruccion, faltantes de despacho y matriz completa de notificaciones. Los flujos ya validados deben repetirse solo con una muestra corta de regresion.

El WMS tiene cuatro componentes operativos:

1. `Dashboard`: operacion visual, consulta, formularios, historicos y administracion.
2. `WhatsApp + BuilderBot`: lenguaje natural, audios, documentos, consultas, tareas y confirmaciones rapidas.
3. `API WMS`: aplica permisos y reglas; dashboard y WhatsApp deben llamar los mismos servicios de dominio.
4. `MySQL`: fuente de verdad para inventario, lotes, reservas, movimientos, Kardex, ordenes y auditoria.

Siigo es el sistema contable externo. En el flujo acordado actualmente:

- Las compras se preparan en el WMS a partir de una OC en PDF; la recepcion fisica no depende de una factura de compra importada desde Siigo.
- Los despachos normales nacen de una factura de venta de Siigo. En pruebas se pueden usar facturas sinteticas locales que no llaman a Siigo.
- El equipo responsable de la integracion Siigo debe entregar su propia evidencia antes de considerarla lista para uso real.

## 5. Modalidades de producto

| Modalidad | Recorrido |
|---|---|
| `PR - Produccion propia` | OC de insumos -> recepcion -> stock de materiales -> OP -> alistamiento FEFO -> produccion -> lote PT -> despacho. |
| `IO - In-and-Out` | OC de producto terminado -> recepcion directa -> lote del proveedor -> almacenamiento -> despacho. No crea OP ni consume BOM. |
| `PT - Maquila 3Q` | Remision de materiales -> salida y custodia externa 3Q -> OC de producto esperado -> recepcion parcial o total -> lote definido por 3Q -> despacho. |

## 6. Roles operativos

| Rol | Responsabilidad principal |
|---|---|
| `admin` | Administracion, liberacion de produccion, excepciones, 3Q y supervision. |
| `recepcion_cierre` | Preparar y confirmar recepciones; cerrar produccion; recibir producto desde 3Q. |
| `alistador` | Confirmar materiales, iniciar produccion, registrar ajustes y confirmar reposiciones. |
| `despacho` | Consultar tareas de despacho, sincronizar facturas autorizadas, confirmar salidas y gestionar devoluciones. |
| `consulta` | Consultas sin operaciones que modifiquen inventario. |

El dashboard permite asignar roles existentes. Los permisos de cada rol estan versionados en codigo; no existe un editor libre de permisos.

## 7. Funcionalidades del dashboard

### 7.1 Inicio

- Resumen por hoy, 7 dias o 30 dias.
- Recepciones, stock, ordenes de produccion, mermas y aprobaciones.
- Excepciones que requieren atencion y actividad reciente.
- Accesos rapidos a operaciones principales.

Estado: `MANUAL VALIDADO` en navegacion y visualizacion basica; requiere regresion completa de cifras contra base.

### 7.2 Recepciones

- Ver PDF de OC recibidos por WhatsApp y descargar el original.
- Revisar datos extraidos y corregir proveedor, SKU, cantidades y unidades antes de crear la OC.
- Crear una OC manual cuando sea necesario.
- Cancelar una OC mientras no tenga recepciones ni vinculos 3Q; conserva motivo, usuario y fecha.
- Preparar recepcion desde una OC abierta.
- Preparar recepcion de producto terminado desde una orden 3Q.
- Dividir una linea entre ubicaciones o condiciones.
- Condiciones: disponible, cuarentena, rechazado y pendiente de disposicion.
- Confirmar la recepcion fisica y consultar historico, diferencias, lotes y usuario.

Estado: compra directa y recepcion por PDF `MANUAL VALIDADO`; recepcion 3Q `PARCIAL` porque falta completar todo el ciclo parcial/final en una nueva corrida.

### 7.3 Inventario

- Resumen general.
- Productos bajo minimo.
- Busqueda profesional por producto o SKU.
- Cantidad disponible, reservada, bloqueada y total.
- Detalle por lote, bodega, ubicacion, estado y vencimiento.
- Busqueda y trazabilidad de un lote.
- Mapa de bodega con posiciones documentadas, stock y productos asignados.

Estado: busqueda de producto, lote y mapa `MANUAL VALIDADO`; bajo minimo y conciliacion global `PENDIENTE` de regresion conjunta.

### 7.4 Productos

- Catalogo, busqueda por SKU o nombre y filtro funcional por tipo.
- Totales disponibles, cuarentena, reservas y fisico.
- Detalle por lote, estado, origen y vencimiento.
- Crear, editar, activar o inactivar productos segun permisos.
- Configurar unidad y stock minimo/maximo.

Estado: consulta y filtro `MANUAL VALIDADO`; altas, cambios e inactivacion deben probarse con un SKU QA nuevo. El formulario actual conserva el tipo tecnico `Product`, por lo que la clasificacion visual depende del SKU y nombre.

### 7.5 Produccion

- Listado con OP, producto, destino, plan, resultado, lote PT, fase, estado, fecha y hora.
- Liberar una OP para stock de seguridad o pedido de cliente.
- Calcular BOM y reservar materiales por FEFO.
- Confirmar materiales e iniciar produccion.
- Registrar entrega adicional o devolucion de materiales por lote y ubicacion.
- Preparar, confirmar o cancelar una reposicion completa de BOM.
- Avanzar fases.
- Cerrar con conformes, merma, motivo y ubicacion.
- Generar automaticamente el lote PT y heredar el vencimiento mas proximo de las gomas consumidas.
- Mostrar conciliacion teorica y real de materiales.

Estado: recorrido normal e idempotencia `MANUAL VALIDADO`; reposicion completa `AUTOMATIZADO` y `PENDIENTE` de prueba manual E2E; politica ante cierre corto sigue pendiente de decision del cliente.

### 7.6 Maquila 3Q

- Leer un PDF de salida como borrador documental.
- Crear orden y remision de materiales sin OC previa.
- Reservar BOM `ENVIO` por FEFO.
- Confirmar salida fisica y registrar custodia externa de 3Q.
- Cancelar una remision aun no enviada.
- Vincular posteriormente una OC compatible.
- Preparar material adicional con motivo.
- Ver acumulado recibido y saldo pendiente.
- Recibir producto terminado desde la pestaña de Recepciones.

Estado: salida previa a OC, lectura documental, vinculacion y bandeja de recepcion `PARCIAL`; faltan recepcion parcial, recepcion final, material adicional, cancelacion y despacho final en una misma corrida.

### 7.7 Despachos

- Sincronizacion manual de facturas de venta de Siigo.
- Bandeja de pendientes y listado historico.
- Cliente, factura, producto, lote, ubicacion, facturado, reservado, faltante y estado.
- Confirmacion de salida fisica.
- Descuento de inventario y liberacion de reserva solo al confirmar.

Estado: despacho sintetico con stock, lote e idempotencia `MANUAL VALIDADO`. Integracion real con Siigo `PARCIAL`, gestionada por el equipo responsable de esa API.

### 7.8 Devoluciones

- Registrar una devolucion vinculada a factura o despacho confirmado.
- Exigir referencia unica, producto, lote origen y cantidad.
- `RECUPERABLE`: crea stock disponible en ubicacion activa.
- `CUARENTENA`: crea lote no disponible.
- `DESTRUCCION`: no suma inventario disponible.
- Consultar historico con cliente, origen, lote nuevo, ubicacion, estado y usuario.

Estado: recuperable y cuarentena `MANUAL VALIDADO`; destruccion e intentos acumulados por encima de lo despachado deben repetirse en la bateria integral.

### 7.9 Mermas

- Registrar merma de bodega por producto, lote, ubicacion, cantidad, referencia y motivo.
- Registrar merma durante una OP.
- Consultar historico por producto, orden/lote, ubicacion, motivo y fecha.
- Desde WhatsApp, generar automaticamente una referencia cuando el operario no dispone de una.

Estado: bodega y proceso `MANUAL VALIDADO`; notificacion proactiva de merma permanece `PENDIENTE` segun politica.

### 7.10 Kardex y trazabilidad

- Buscar movimientos por producto.
- Mostrar ingreso, reserva/consumo, produccion, merma, devolucion y despacho.
- Reconstruir hacia atras proveedor/OC/recepcion y hacia adelante factura/despacho/cliente.
- Conservar lote, ubicacion, cantidad, saldo, referencia y fecha.

Estado: trazabilidad de PR e IO `MANUAL VALIDADO`; trazabilidad completa de 3Q hasta cliente final `PENDIENTE`.

### 7.11 Aprobaciones

- Pendientes e historico.
- Aprobar o rechazar solicitudes heredadas.
- Mostrar solicitante, procesador, fecha, resultado y motivo.
- Evitar repetir la accion al aprobar dos veces.

Estado: `MANUAL VALIDADO` para compatibilidad. No es el flujo principal nuevo de recepcion, produccion ni despacho.

### 7.12 Usuarios, notificaciones y logs

- Asignar roles existentes a usuarios activos.
- Consultar notificaciones WhatsApp, destinatario enmascarado, estado, intentos y errores.
- Reintentar una notificacion fallida.
- Consultar logs BuilderBot por estado, prioridad y origen.

Estado: cambios de rol y consulta de logs `MANUAL VALIDADO`; reintento controlado de una notificacion fallida `PENDIENTE`.

## 8. Funcionalidades por WhatsApp

### 8.1 Consultas

- Conversacion general y ayuda operativa.
- Stock de materia prima o producto terminado.
- Capacidad maxima de fabricacion y faltantes para una cantidad propuesta.
- Estado de ordenes de produccion.
- Recepciones pendientes, discriminadas entre insumos, IO y producto desde 3Q.
- Despachos pendientes con cliente, cantidades, lotes y ubicaciones.
- Solicitudes heredadas pendientes.
- Trazabilidad completa de lote.

Estado: `MANUAL VALIDADO`; mensajes fueron reformateados para lectura por bloques. Debe repetirse con texto y audio.

### 8.2 Documentos

- Recibir PDF de OC y crear un borrador sin modificar inventario.
- Revisar y confirmar una OC consistente por WhatsApp.
- Recibir PDF de salida a 3Q como borrador documental.
- Rechazar archivos que no sean PDF validos, sean demasiado grandes, provengan de origen no permitido o contengan SKU/cantidades no sustentados.
- Evitar duplicados y detectar un mismo numero con contenido operativo diferente.

Estado: OC y salida 3Q `MANUAL VALIDADO` en ejemplos controlados; documentos reales variables `PENDIENTE` de muestreo con el cliente.

### 8.3 Recepcion

- Listar OC pendientes con ID corto.
- Preparar una recepcion sin modificar inventario.
- Usar alias humanos dentro de los productos de la OC.
- Generar y conservar un resumen fisico antes de confirmar.
- Confirmar con intencion explicita e ID coincidente.
- Repetir sin duplicar stock o Kardex.

Estado: `MANUAL VALIDADO` para compra directa e IO. La recepcion operativa desde 3Q se realiza actualmente en dashboard.

### 8.4 Produccion

- Liberar una OP usando SKU o alias.
- Preguntar si es stock de seguridad o pedido de cliente cuando el mensaje no lo indique.
- Mostrar la cantidad interpretada antes del alistamiento.
- Confirmar materiales por ID corto.
- Registrar merma de proceso con lenguaje natural.
- Registrar entrega adicional y devolucion de materiales.
- Preparar y confirmar reposicion de BOM.
- Cerrar produccion; el usuario informa resultado, merma y ubicacion, pero no inventa lote ni vencimiento PT.
- Repetir inicio o cierre sin segundo movimiento.

Estado: liberacion, inicio, merma y cierre `MANUAL VALIDADO`; reposicion `PENDIENTE` de prueba conversacional completa.

### 8.5 Despacho, devolucion y notificaciones

- Consultar facturas y tareas de despacho.
- Confirmar despacho por ID corto, factura o numero visible.
- Bloquear el despacho libre que no provenga de factura.
- Registrar devoluciones trazables.
- Avisar al alistador, admin, responsable de recepcion/cierre o despacho segun evento.
- Registrar cada envio con clave idempotente.

Estado: despacho y notificaciones de produccion `MANUAL VALIDADO`; matriz completa de destinatarios, devoluciones y errores de envio `PARCIAL`.

### 8.6 Limite actual de WhatsApp para 3Q

WhatsApp lee la salida 3Q como documento y puede listar la recepcion pendiente. No crea ni confirma la remision operativa, no vincula la OC y no aprueba la recepcion 3Q. Estas acciones se ejecutan en dashboard.

## 9. Capacidades desactivadas o no prometidas

- Despacho directo sin factura: `DESACTIVADO`.
- Despachos parciales: estructura existente, ejecucion `DESACTIVADA`.
- Division de una linea de produccion: `DESACTIVADA`.
- Liberacion automatica de reservas antiguas: `DESACTIVADA`.
- Alertas automaticas de backorder: `DESACTIVADAS`.
- Consumo de cajas de despacho: decision de negocio pendiente; no participa en los flujos actuales.
- Operacion completa de 3Q por WhatsApp: `FUERA DE ALCANCE ACTUAL`.
- Editor libre de permisos y roles: `FUERA DE ALCANCE ACTUAL`.
- Creacion de ventas normales desde el WMS: `FUERA DE ALCANCE`; la factura nace en Siigo.
- Crear una OP de pedido sin referencia y cliente final: bloqueado. Sigue pendiente decidir si esa referencia debe corresponder obligatoriamente a una OC cargada.

## 10. Preparacion de la jornada integral

### 10.1 Responsables

Usar tres lineas humanas y una linea del agente:

1. Linea A fija como `admin`.
2. Linea B fija como `recepcion_cierre`.
3. Linea C como `alistador`; cambiarla una sola vez a `despacho` al terminar produccion y 3Q.
4. La linea del agente nunca debe estar asociada a un usuario operativo.

### 10.2 Datos

- Definir `RUN_ID=SOCIO-AAAAMMDD-HHMM`.
- Usar SKU reales con documentos, lotes, terceros y cantidades claramente marcados como QA.
- No reutilizar OC, recepciones, OP, lotes, facturas o despachos de otra corrida.
- Generar un paquete documental nuevo a partir de los scripts de demo; primero dry-run.
- Registrar stock inicial y reservas antes de comenzar.
- Mantener Siigo fuera del camino critico usando facturas sinteticas, salvo en el bloque exclusivo de integracion.

### 10.3 Puerta tecnica

El responsable tecnico debe ejecutar antes de la sesion:

```powershell
npm.cmd test
cd frontend
npm.cmd run build
```

Tambien debe validar salud del despliegue, conexion MySQL, roles, ubicaciones, BOM, stock suficiente e invariantes: cero stock negativo, cero reserva negativa y cero reserva superior al stock.

## 11. Bateria de pruebas conjunta

### Bloque A. Acceso, roles y navegacion

1. Login valido y clave invalida.
2. Abrir cada opcion visible para el rol.
3. Intentar una accion prohibida desde cada rol.
4. Cambiar el rol de la linea C y comprobar que dashboard y WhatsApp lo aplican inmediatamente.

Aprueba si ninguna accion fuera de rol modifica datos y no aparece una pantalla en blanco o error interno.

### Bloque B. OC por PDF y recepcion de insumos

1. Enviar una OC nueva por WhatsApp.
2. Verificar borrador y ausencia de stock nuevo.
3. Revisar/corregir en dashboard y crear la OC.
4. Listar y preparar la recepcion por ID corto.
5. Confirmar una recepcion exacta.
6. Repetir la confirmacion.
7. Crear otra OC y distribuir una linea entre disponible, cuarentena y rechazo.
8. Confirmar una recepcion parcial y comprobar que la OC siga abierta.
9. Cancelar una OC intacta; intentar cancelar otra ya recibida.

Aprueba si solo disponible suma stock, el reintento no duplica, las diferencias quedan visibles y una OC usada no puede cancelarse.

### Bloque C. Produccion propia completa

1. Crear una OP de 3 unidades para stock de seguridad usando un alias.
2. Comprobar producto, cantidad interpretada, BOM, FEFO, lotes, ubicaciones y reservas.
3. Confirmar materiales como Alistador.
4. Comprobar un solo consumo y estado `EN_PROCESO`.
5. Registrar una merma de proceso con alias y referencia automatica.
6. Registrar una entrega adicional y una devolucion valida.
7. Intentar devolver mas de lo consumido.
8. Cerrar con plan completo y cero merma de cierre.
9. Repetir cierre desde dos roles autorizados/no autorizados.
10. Consultar lote PT y trazabilidad.

Aprueba si el PT hereda vencimiento de las gomas, el lote lo genera el WMS, los ajustes concilian y los reintentos no crean movimientos adicionales.

### Bloque D. Reposicion de materiales

1. Crear y comenzar una OP nueva.
2. Declarar un resultado corto que requiera completar unidades.
3. Admin prepara reposicion por el BOM completo.
4. Comprobar que solo reserva.
5. Intentar cerrar mientras la reposicion esta pendiente.
6. Alistador confirma la reposicion.
7. Comprobar descuento, entrega adicional y estado `EN_PROCESO`.
8. Cerrar la OP completa.
9. Repetir con una reposicion cancelada y confirmar liberacion de reservas.

Aprueba si ninguna reposicion descuenta antes del Alistador y una pendiente bloquea el cierre.

### Bloque E. In-and-Out

1. Cargar OC PDF de 5 unidades IO con lote y vencimiento.
2. Recibirlas directamente sin crear OP.
3. Confirmar lote, ubicacion y 5 disponibles.
4. Crear factura sintetica de 2 unidades.
5. Confirmar despacho y comprobar saldo 3.
6. Repetir despacho.
7. Consultar trazabilidad desde OC/proveedor hasta factura/cliente.

Aprueba si no aparece BOM ni produccion y existe un solo ingreso y un solo despacho.

### Bloque F. Maquila 3Q

1. Cargar el PDF de salida 3Q como borrador.
2. Crear remision sin OC y comprobar reserva FEFO.
3. Confirmar salida; verificar descuento y estado `EN_3Q_PENDIENTE_OC`.
4. Repetir la confirmacion.
5. Intentar recibir PT antes de vincular OC; debe bloquearse.
6. Cargar la OC de producto esperado y vincularla.
7. Recibir 3 de 4 unidades con lote A.
8. Confirmar estado `RECIBIDA_PARCIAL` y saldo 1.
9. Recibir la unidad restante con lote B.
10. Confirmar estado `COMPLETADA`.
11. En una orden aparte, preparar y cancelar una remision antes de enviarla.
12. En otra, enviar material adicional con motivo.
13. Crear despacho sintetico de 2 unidades y consultar trazabilidad completa.

Aprueba si 3Q nunca aparece como bodega interna, cada salida conserva lote/ubicacion de origen y el PT no puede recibirse sin OC valida.

### Bloque G. Despachos y faltantes

1. Crear una tarea con stock completo.
2. Verificar lote y ubicacion en dashboard y WhatsApp.
3. Confirmar como rol incorrecto y luego como Despacho.
4. Repetir confirmacion.
5. Crear una factura sintetica sin stock suficiente.
6. Comprobar que queda bloqueada y no permite salida.
7. Confirmar que una solicitud directa sin factura es rechazada.

Aprueba si el inventario baja solo al confirmar fisicamente y nunca supera lo facturado.

### Bloque H. Devoluciones y mermas

1. Sobre un despacho confirmado, registrar devolucion recuperable.
2. Registrar otra en cuarentena y otra para destruccion.
3. Intentar devolver mas de lo despachado o repetir una referencia con datos diferentes.
4. Registrar merma de bodega valida y otra superior al disponible.
5. Revisar historicos, lotes, ubicaciones, estados y Kardex.

Aprueba si solo recuperable aumenta disponible y ningun rechazo deja saldos parciales.

### Bloque I. Consultas, trazabilidad y lenguaje natural

Probar por texto y audio:

1. Stock y ubicaciones usando SKU y alias.
2. Capacidad maxima y capacidad para una cantidad imposible.
3. OP activas y estado de una OP especifica.
4. Recepciones y despachos pendientes.
5. Trazabilidad de MP, PT propio, IO y PT de 3Q.
6. Alias ambiguo, codigo mal transcrito y correccion en el siguiente mensaje.
7. Confirmaciones vagas como `listo` o `proceda`.

Aprueba si las consultas no modifican datos, las ambiguedades fallan cerrado y las respuestas no contienen JSON, `undefined`, placeholders o bloques ilegibles.

### Bloque J. Notificaciones y observabilidad

1. OP liberada -> Alistador.
2. Produccion iniciada -> Admin y Recepcion/Cierre.
3. Produccion cerrada -> Admin.
4. Despacho listo: comprobar que queda visible en dashboard y en la consulta de pendientes por WhatsApp. No se requiere aviso proactivo.
5. Forzar una notificacion fallida controlada y reintentar desde dashboard.
6. Repetir el evento y comprobar un solo envio por destinatario.
7. Cruzar WhatsApp, Notificaciones y Webhook Logs por hora y referencia.

Aprueba si el actor no recibe duplicado proactivo, el destinatario depende del rol vigente y una falla de WhatsApp no revierte la operacion WMS.

### Bloque K. Conciliacion final

Para cada `RUN_ID`, comparar dashboard y base:

- Stock fisico, reservado y disponible.
- Lotes, estados, vencimientos y ubicaciones.
- Movimientos y Kardex.
- OC, recepciones, OP, remisiones 3Q, despachos, devoluciones y mermas.
- Usuario, rol, canal, fecha y hora.
- Notificaciones y errores.

La corrida aprueba solo con cero stock negativo, cero reservas imposibles, cero mutaciones duplicadas y trazabilidad completa.

## 12. Evidencia que debe guardar el socio

Por cada caso registrar:

| Campo | Contenido |
|---|---|
| Caso | Codigo del bloque y numero de prueba. |
| Fecha/hora | Hora local de ejecucion. |
| Usuario/rol | Rol efectivo, no solo nombre de la persona. |
| Canal | Dashboard, texto WhatsApp, audio, API o automatico. |
| Entrada | Mensaje, documento o formulario utilizado. |
| Respuesta | Texto exacto o captura. |
| Entidades | OC, REC, OP, MQ, REM, lote, factura, despacho o devolucion. |
| Antes/despues | Stock, reserva, estado y saldo del lote. |
| Resultado | Aprobado, fallido o bloqueado. |
| Observacion | Diferencia entre lo esperado y lo ocurrido. |

Formato recomendado para reportar un defecto:

```text
Caso: F-07
Rol/canal: recepcion_cierre / dashboard
Entrada: recepcion parcial de 3 unidades
Esperado: orden RECIBIDA_PARCIAL, acumulado 3, saldo 1
Obtenido: ...
Entidad: MQ-3Q-... / REC-3Q-...
Hora: ...
Captura o log: ...
Reintento realizado: si/no
Impacto observado en inventario: ...
```

No corregir manualmente la base durante la sesion. Primero conservar evidencia y comprobar si la operacion fue rechazada, procesada o quedo en espera.

## 13. Orden recomendado para la reunion

1. Puerta tecnica y roles.
2. OC/recepcion de insumos.
3. Produccion propia y reposicion.
4. In-and-Out.
5. Maquila 3Q.
6. Despachos.
7. Devoluciones y mermas.
8. Consultas, audios y trazabilidad.
9. Notificaciones y logs.
10. Conciliacion final y priorizacion de defectos.

Esta secuencia reduce cambios de rol: Recepcion/Cierre trabaja primero; Alistador ejecuta produccion; despues esa linea cambia una sola vez a Despacho.

## 14. Decisiones que deben salir de la validacion

1. Si una recepcion exacta puede confirmarse desde el resumen o exige declarar cada item.
2. Si toda OP para pedido debe vincularse obligatoriamente a una OC de cliente cargada.
3. Si una OP corta se cierra, queda abierta o exige reposicion para completar el plan.
4. Tratamiento de componentes cuando se pierde una unidad terminada.
5. Si todos los IO llegan con lote de proveedor.
6. Si 3Q puede entregar el mismo lote en varias recepciones o varios lotes en una entrega.
7. Manejo de sobrantes, devoluciones, material adicional y sobreentrega de 3Q.
8. Eventos y destinatarios definitivos de notificaciones.
9. Politica de cajas de despacho y excepciones por falta de embalaje.
10. Tolerancias que requieren segunda aprobacion.

## 15. Criterio de cierre

El WMS estara listo para una siguiente fase cuando los recorridos PR, IO y PT puedan repetirse con datos nuevos; dashboard y WhatsApp produzcan el mismo resultado; los roles bloqueen acciones indebidas; y cada unidad pueda rastrearse desde su entrada o produccion hasta el cliente final sin ajustes manuales de base.

Documentos relacionados:

- `docs/builderbot-agent-map.md`
- `docs/demo-cliente-2026-09-02.md`
- `docs/flujo-orden-compra-y-maquila-3q.md`
- `docs/politica-notificaciones-operativas.md`
- `docs/plan-pruebas-e2e-wms.md`
- `docs/PROJECT_CHANGELOG.md`
