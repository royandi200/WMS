# Plan de implementacion de pendientes post-QA

**Fecha de revision:** 2026-09-05
**Base revisada:** `main` en `c1bd4f4`
**Fuentes:** bitacora manual P-001 a P-030, guia funcional integral, auditoria independiente F-01 a F-10 y codigo actual.

## Objetivo

Cerrar los pendientes encontrados durante las pruebas sin debilitar controles de inventario, duplicar logica entre dashboard y WhatsApp ni convertir decisiones de negocio aun abiertas en comportamiento irreversible.

El orden de este plan sigue cuatro reglas:

1. Seguridad e integridad antes que presentacion.
2. Un solo servicio de dominio para cada mutacion, compartido por dashboard y WhatsApp.
3. Idempotencia persistente: mismo evento y mismo contenido devuelve el resultado original; mismo evento con contenido diferente responde conflicto.
4. Las existencias fisicas, la disponibilidad y la reserva se muestran como conceptos distintos.

## Diagnostico ejecutivo

- Los 30 pendientes manuales siguen documentados. Los cambios recientes del mapa de bodega no los resuelven ni los empeoran.
- La mayoria no requiere 30 implementaciones independientes. Se consolidan en 8 paquetes con causas comunes.
- Hay cinco bloqueadores preproductivos de seguridad: autenticacion de BuilderBot, webhooks SIIGO debiles, ruta heredada de aprobaciones, migraciones no reproducibles e idempotencia incompleta.
- Los flujos modernos ya tienen buenos controles transaccionales y FEFO. El trabajo debe extenderlos, no reescribirlos.
- Las decisiones del cliente no bloquean el inicio. Se pueden aplicar estados conservadores y reversibles mientras se confirman disposicion final, indicadores y semantica de custodia 3Q.

## Estado de implementacion local - 2026-09-05

Se ejecutaron los paquetes priorizados por Juan: cierre de rutas paralelas de mutacion, integridad de identificadores e idempotencia, reduccion del `health` publico y mejoras operativas de inventario, devoluciones, produccion, despacho, maquila y consultas.

| Estado | Pendientes | Evidencia local |
|---|---|---|
| Implementado y cubierto automaticamente | P-001, P-002, P-004, P-005, P-006, P-007, P-008, P-009, P-010, P-011, P-012, P-013, P-015, P-016, P-017, P-018, P-019, P-020, P-021, P-022, P-023, P-024, P-025, P-026, P-027, P-028, P-029, P-030 | Suite automatizada, build Vite y auditor MySQL sin fallos. |
| Implementado; requiere repetir recorrido visual/manual | P-001, P-003, P-005, P-007, P-008, P-009, P-010, P-012, P-013, P-016, P-017, P-019, P-020, P-021, P-022, P-025, P-026, P-027, P-028, P-029 | Casos definidos en `bateria-regresion-integral-post-mejoras.md`. |
| Decision del cliente; estado conservador aplicado | P-014 | La opcion se oculta y el backend rechaza nuevas disposiciones por defecto. Los historicos conservan `PENDIENTE_DISPOSICION`; las nuevas devoluciones permanecen en cuarentena. |

Las aprobaciones heredadas de inicio de produccion, cierre y despacho quedaron visibles solo como evidencia historica y no pueden volver a mutar inventario. Las operaciones vigentes se ejecutan mediante los servicios de dominio compartidos por dashboard y WhatsApp.

Este estado es local: no equivale a despliegue ni a aceptacion manual. La validacion completa posterior debe seguir la bateria de regresion y registrar evidencia por escenario.

## Orden de implementacion

### Fase 0 - Congelar una linea base confiable

**Alcance:** P-030 y preparacion de pruebas.

1. Rehacer `scripts/qa/e2e-database-audit.js` para que cree o seleccione un escenario identificado por referencia de QA y valide invariantes, no la ultima OP ni cifras fijas.
2. Incorporar prefijos unicos por corrida, registro de datos creados y limpieza dirigida.
3. Separar pruebas puras, integracion MySQL y pruebas live. Ninguna prueba automatica debe enviar WhatsApp o tocar SIIGO sin un flag explicito.
4. Guardar una linea base de conteos e invariantes antes de cada paquete.

**Aceptacion:** la suite no cambia de resultado por nuevas OP legitimas; una corrupcion deliberada del fixture hace fallar el auditor correcto; la limpieza no toca datos fuera de la corrida.

### Fase 1 - Cerrar exposicion y rutas paralelas

**Alcance:** F-01, F-02, F-03, F-09 y F-10.

1. Desactivar por defecto los webhooks SIIGO de facturas, compras y notas credito que solo validan `Partner-Id`. Mantener el polling autenticado como camino operativo hasta disponer de firma verificable, ID de evento y proteccion contra replay.
2. Conservar `g0m@s` exclusivamente como palabra de enrutamiento de BuilderBot. Nunca debe autenticar la solicitud. Exigir un secreto de transporte en header y derivar la identidad solo de un cuerpo recibido por ese canal autenticado.
3. Hacer que las aprobaciones del dashboard invoquen los mismos servicios modernos de recepcion, produccion y despacho usados por WhatsApp. Retirar las mutaciones duplicadas de `approvals/approve` cuando exista paridad.
4. Cambiar notificaciones salientes a `default-off`; habilitarlas solo mediante configuracion positiva del entorno. Separar permiso de reintento de permiso de lectura.
5. Reducir el health publico a estado general. Mover detalles de BD y esquema a una ruta administrativa autenticada.

**Aceptacion:** alterar `from`, `action` o `params` sin credencial valida falla; `g0m@s` por si sola no autoriza; un replay SIIGO no muta inventario; dashboard y WhatsApp generan los mismos movimientos; una instalacion sin flag no envia mensajes.

### Fase 2 - Integridad de identificadores, auditoria e idempotencia

**Alcance:** P-002, P-006, P-011, P-015, P-018, F-04 y parte de F-06.

1. Alinear el enum de `webhook_logs` con los estados escritos por la API o mapear `DENIED` a `REJECTED` de forma unica. Preferencia: agregar `DENIED` para conservar la diferencia entre RBAC y payload invalido.
2. Sustituir el numero de despacho truncado por un identificador legible con sufijo hash estable de `siigo_invoice_id`. Mantener `siigo_invoice_id` como clave externa unica y preparar una migracion que detecte colisiones existentes sin renombrar historicos silenciosamente.
3. Crear un mecanismo comun de identidad de operacion para devoluciones, mermas, liberacion de OP y ajustes de materiales: clave de transporte o confirmacion, hash canonico, resultado persistido y restriccion unica.
4. Generar referencias WMS automaticamente. La referencia del cliente queda opcional y no se usa como unica barrera contra duplicados.
5. Para un reintento tardio sin identidad suficiente, pedir una aclaracion corta: confirmar si es el mismo incidente o una perdida nueva. No ampliar simplemente la ventana de dos minutos.
6. Versionar las nuevas migraciones con tabla de version, checksum y estado; iniciar la convergencia hacia un unico comando de instalacion.

**Aceptacion:** concurrencia y doble clic producen una sola mutacion; misma clave con contenido distinto responde 409; dos facturas largas similares producen despachos distintos; un rechazo RBAC queda auditable; el operario no inventa codigos tecnicos.

### Fase 3 - Modelo fisico de devoluciones y disposicion

**Alcance:** P-009, P-010, P-012, P-013, P-014 y F-05 para devoluciones.

1. Mantener separados tres valores: cantidad fisica del lote, variacion de disponible y saldo del lote.
2. Registrar toda devolucion como movimiento fisico positivo del nuevo lote. Una devolucion en cuarentena o pendiente de disposicion aumenta existencia fisica, pero no disponible.
3. Calcular `balance_after` como saldo del lote asociado al movimiento, no como disponible agregado del producto.
4. Hacer que Buscar producto agregue lotes disponibles, cuarentena y pendiente de disposicion. `TOTAL FISICO = DISPONIBLE + BLOQUEADO`, sin sumar reservas dos veces.
5. Persistir motivo/observaciones desde la interpretacion hasta `devoluciones`, Kardex, historial y trazabilidad.
6. Mejorar el rechazo por exceso con despachado, devuelto y maximo retornable, respetando singular/plural.
7. Renombrar el destino `DESTRUCCION` a `PENDIENTE DE DISPOSICION` hasta confirmar fisicamente la destruccion.

**Decision reversible propuesta para P-014:** crear los estados `PENDIENTE_DISPOSICION` y `DISPUESTO`, pero dejar desactivada la accion final hasta que el cliente defina actor, evidencia y aprobacion.

**Aceptacion:** una unidad en cuarentena aparece como una unidad bloqueada y cero disponible; su Kardex muestra entrada fisica `+1` y saldo de lote `1`; el motivo es consultable; ningun estado bloqueado puede reservarse o despacharse.

### Fase 4 - Veracidad de despacho y produccion

**Alcance:** P-008, P-016, P-017, P-019, P-020, P-021, P-028 y F-05.

1. En despachos pendientes mostrar por item: solicitado, reservado, faltante, lote y estado. Usar `PENDIENTE_STOCK` y ocultar/deshabilitar confirmar mientras falte cobertura, conservando el bloqueo del backend.
2. En historico separar `asignado historico`, `despachado` y `reserva activa`; no rotular una asignacion consumida como reserva vigente.
3. En capacidad y faltantes mostrar nombre corto, SKU, unidad y material limitante. No reducir automaticamente la cantidad solicitada.
4. Unificar plantillas de produccion por destinatario:
   - administrador: estado y responsable del siguiente paso;
   - alistador: instruccion accionable, ID corto, nombre, SKU, cantidad, unidad, lote y ubicacion;
   - recepcion/cierre: estado, conciliacion y excepciones.
5. Notificar al alistador cuando una reposicion sea cancelada y marcar la instruccion previa como no vigente.
6. En cierre sin conformes omitir lote/ubicacion o mostrar `Sin lote conforme` y `No aplica`; nunca `null`.
7. Mostrar dos indicadores distintos: cumplimiento contra plan y tasa de no conformidad sobre resultado fisico. No llamar a ambos `porcentaje de merma`.
8. Aplicar limites conservadores: sobreproduccion o sobre-recepcion no entra directamente a disponible; queda como excepcion bloqueada hasta aprobacion.

**Aceptacion:** no se ofrece confirmar un despacho incompleto; cada destinatario recibe solo su siguiente accion; cancelar elimina reservas y avisa al ejecutor; cierres de cero conformes no exponen nulos; excesos nunca inflan disponible sin aprobacion.

### Fase 5 - Evidencia y trazabilidad de maquila 3Q

**Alcance:** P-022, P-023, P-024, P-025, P-026 y P-027.

1. Reutilizar para remisiones 3Q el almacenamiento seguro ya usado por OC: HTTPS, dominio permitido, limite de tamano, firma PDF, hash, descarga autenticada y sin URL temporal en logs.
2. Añadir una bandeja temporal de adjuntos por remitente con expiracion corta y seleccion explicita. Si llega PDF y luego texto, pedir confirmacion del documento; nunca reutilizar silenciosamente un archivo anterior.
3. No exigir lote ni vencimiento en el PDF previo de salida a 3Q. El WMS debe asignarlos al preparar la remision mediante FEFO y mostrarlos para confirmacion.
4. Agregar nombre corto y unidad al picking sin retirar SKU, lote o ubicacion.
5. Durante recepciones parciales mostrar por separado `enviado`, `PT recibido`, `material pendiente de conciliacion` y `merma reportada`. No afirmar existencia fisica exacta en 3Q ni inferir consumo proporcional.
6. Extender trazabilidad del PT tercerizado: recepcion 3Q -> orden de maquila -> remision -> lotes y ubicaciones de materiales enviados -> recepcion parcial/final -> despachos y clientes.

**Decision reversible propuesta para P-026:** cambiar la etiqueta `Custodia 3Q` por `Material enviado pendiente de conciliacion` hasta que el cliente confirme si reportara consumos parciales.

**Aceptacion:** el PDF se descarga con autorizacion y hash verificable; archivo y texto separados no duplican ni cruzan remitentes; el picking FEFO determina lotes; la trazabilidad distingue maquila externa de produccion propia y usa evidencia real, no BOM teorico como sustituto.

### Fase 6 - Consistencia de consultas y dashboard

**Alcance:** P-001, P-003, P-004, P-005, P-007 y P-029.

1. Centralizar fechas en una utilidad de presentacion `America/Bogota`; conservar UTC en BD y API cuando corresponda.
2. Renombrar las columnas de recepcion segun su dato real. No mostrar `Factura` si el valor es acumulado recibido/aceptado.
3. Vincular borrador documental y OC operativa con estados claros: pendiente, convertido, corregido, descartado. Ocultar de la bandeja activa el convertido sin borrar evidencia.
4. Hacer que trazabilidad muestre solo secciones aplicables y ofrezca detalle adicional cuando el canal pueda truncar el mensaje.
5. Resolver consultas por alias mostrando tipo maestro real, ubicaciones solicitadas y hasta cinco candidatos cuando exista ambiguedad. Mantener fallo cerrado para acciones destructivas.
6. Investigar P-001 con version de bundle y cache. Añadir recuperacion controlada para errores de carga de chunks una sola vez, telemetria de version y mensaje de actualizacion; evitar bucles de recarga.

**Aceptacion:** dashboard y WhatsApp muestran la misma hora local; documentos convertidos no parecen pendientes; las consultas no incluyen secciones vacias; un alias ambiguo pide elegir; un chunk obsoleto se recupera una vez y deja evidencia diagnostica.

### Fase 7 - Endurecimiento preproductivo y certificacion

**Alcance:** F-06, F-07, F-08 y regresion completa.

1. Completar migrador unico, versionado e idempotente; probar instalacion desde BD vacia y restauracion.
2. Añadir rate limiting por cuenta/IP, backoff, alertas y politica de refresh token con rotacion/revocacion.
3. Sustituir logs de payload completo por allowlist, enmascarar telefonos y definir retencion. Probar que secretos y PII no llegan a consola ni BD.
4. Ejecutar pruebas de contrato, MySQL real, concurrencia, rollback, RBAC por rol, dashboard y WhatsApp.
5. Ejecutar el checklist de seguridad WMS: stock negativo, doble reserva, FEFO, ubicaciones inactivas, vencidos, cuarentena, replay, doble clic y paridad de canales.

**Aceptacion:** una BD vacia queda operativa mediante un comando; pruebas concurrentes no duplican movimientos; logs no exponen PII/secretos; todas las rutas mutantes exigen identidad y capacidad; suite, build y E2E controlado quedan verdes.

## Matriz de cobertura de pendientes manuales

| Paquete | Pendientes |
|---|---|
| Base de pruebas | P-030 |
| Auditoria e idempotencia | P-002, P-006, P-011, P-015, P-018 |
| Devoluciones y disposicion | P-009, P-010, P-012, P-013, P-014 |
| Despacho y produccion | P-008, P-016, P-017, P-019, P-020, P-021, P-028 |
| Maquila 3Q | P-022, P-023, P-024, P-025, P-026, P-027 |
| Consultas y dashboard | P-001, P-003, P-004, P-005, P-007, P-029 |

Los 30 identificadores quedan cubiertos exactamente una vez en la matriz. Las ampliaciones de la bitacora se validan dentro del mismo trabajo y no generan implementaciones duplicadas.

## Decisiones que deben confirmarse con el cliente

Estas decisiones no bloquean las fases 0 a 2:

1. **Disposicion final:** quien confirma destruccion, que evidencia exige y si necesita doble aprobacion.
2. **Indicadores:** nombres aceptados para cumplimiento del plan y tasa de no conformidad.
3. **Parciales 3Q:** si 3Q reportara consumo/merma por entrega parcial o solo una conciliacion final.
4. **Tolerancias:** limites por SKU para sobre-recepcion, sobreproduccion y diferencias aceptables.

Mientras se confirman, el sistema debe optar por el estado mas conservador: bloqueado, pendiente de conciliacion o pendiente de aprobacion; nunca disponible por inferencia.

## Entregas recomendadas

1. **Entrega A - Seguridad y linea base:** fases 0 y 1.
2. **Entrega B - Integridad operativa:** fases 2 y 3.
3. **Entrega C - Despacho y produccion:** fase 4.
4. **Entrega D - Maquila y trazabilidad:** fase 5.
5. **Entrega E - Experiencia y certificacion:** fases 6 y 7.

Cada entrega debe incluir migracion reversible, pruebas unitarias, prueba de integracion MySQL, build frontend cuando aplique, evidencia del diff y una lista corta de pruebas manuales. No se mezclan cambios de datos maestros reales con cambios de codigo.

## Criterio de cierre global

El plan se considera cerrado cuando:

- los P-001 a P-030 tienen evidencia de prueba y estado `RESUELTO` o `DECISION_CLIENTE`;
- F-01 a F-10 tienen control implementado y riesgo residual documentado;
- dashboard y WhatsApp comparten servicios e invariantes;
- ninguna existencia bloqueada suma disponible;
- todo movimiento destructivo es autenticado, autorizado, transaccional, idempotente y auditable;
- la instalacion y restauracion de la base son reproducibles;
- la bateria integral se puede repetir sin depender del ultimo dato creado en la BD.
