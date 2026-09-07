# Validacion dirigida antes de repetir la bateria

Fecha: 2026-09-06. Horas America/Bogota. Corte: 21:20.
Estado: validacion interna realizada; NO aprobacion integral de WhatsApp ni de produccion.
Cambios locales, sin commit/push/despliegue ni sincronizacion de BBC en esta corrida.

## Alcance y protecciones

- Continuacion de los paquetes 3, 4 y 5 del consolidado. Auditoria standard limitada a estos cambios.
- No se reenviaron PDF ni mensajes WhatsApp. Cada nueva accion por ese canal requiere autorizacion explicita de Juan.
- No se modificaron inventario, roles, configuracion BBC, extractor documental, credenciales ni Siigo.
- No se repitieron las cargas R13 aprobadas: conservan su evidencia historica, no se presentan como pruebas nuevas.
- Los cambios ajenos de package-lock, generacion de PDF y documentos previos permanecen fuera de estos arreglos.

## Resultados reproducibles

| Inicio | Validacion | Resultado y alcance |
|---|---|---|
| 21:20:00 | `npm test` | 314/314, cero fallos/omitidas. Diez casos adicionales respecto de 304. Dominio y handlers con dependencias simuladas; no mensajes reales. |
| 21:20:06 | `npm run build`, dentro de frontend | Correcto, 1534 modulos. No instalacion ni actualizacion de librerias. |
| 21:20:11 | `node scripts/qa/check-pending-reads.js` | 13 SELECT, cuatro GET locales y dos consultas de stock contra SQL real. Transaccion READ ONLY terminada con rollback. Valida esquema/ejecucion, NO autenticacion HTTP ni completitud semantica del filtro MP. |
| 21:20:18 | `node scripts/qa/e2e-database-audit.js` | 10/10 controles SQL. Sin negativos ni reservas superiores al stock. Muestra historica QA: no equivale a repetir flujos. Ultima OP cerrada seleccionada: 81, cero conformes y sin lote ficticio. |
| Antes del corte 21:18 | `scripts/qa/check-pending-ui.cjs` | Cuatro escenarios en 1440x1000 y 390x844: unidades separadas, respuesta tardia al cambiar producto/lote, distribuciones en historico, columna Sin asignar. Chrome aislado, API simulada, red externa bloqueada, cero errores de pagina. |

Las capturas se guardan en `output/qa/pending-ui-20260906/`. Se revisaron visualmente el resumen movil y el historico desktop; la tabla conserva desplazamiento horizontal para columnas extensas.
El servidor y Chrome de esta validacion se cerraron al terminar; no se tocaron las ventanas de WhatsApp del usuario.

Comando visual (Playwright instalado o ruta del modulo como segundo argumento):

```text
node scripts/qa/check-pending-ui.cjs [ruta-al-modulo-playwright]
```

Conteos de control SQL al cierre: Kardex 358, movimientos 359; coinciden con el corte anterior. No se ejecutaron mutaciones para conseguir resultados positivos.

## Ajustes locales cubiertos

| Pendiente | Cambio | Evidencia / limite |
|---|---|---|
| RI-003 | Prompt explicita un SKU con varias distribuciones, resumen previo y campos obligatorios. | Caso 3 disponibles + 1 cuarentena + 1 rechazado pasa normalizacion con lotes distintos; conserva motivos/ubicaciones. Falta interpretar ese mensaje con el modelo real. |
| RI-006 | Prompt distingue devolucion de materiales de OP de devolucion de cliente. Guard evita ejecutar esta ultima si el texto indica retorno de OP. | Handler real simulado bloquea antes de invocar devolucion. No se relajan permisos ni se fuerza una mutacion alternativa. |
| RI-009 | Se elimina del prompt la instruccion contradictoria de sustituir destruccion por cuarentena. Guard bloquea esa sustitucion. | Error SQL saneado en respuesta publica; diagnostico interno conservado. No se agregan reintentos automaticos. Causa del deadlock historico sigue sin demostrar. |
| RI-001 | Catalogo, permanencia, resumen y consulta stock WhatsApp usan saldo elegible por lote/ubicacion/bodega activa/vencimiento/reserva. Se elimina fallback de lectura a otras bodegas. | Consultas reales compilan. Ashwagandha60: fisico171.5, disponible165.75 und. Gomas ashwa: fisico6606.1, reservado3160, disponible2945.25g. No son ajustes de stock. |
| RI-002 | Resumen agrupa cantidades, disponibles y reservas por unidad. g/gr se normalizan; dato sin unidad no se presume pieza. | No se publica escalar mixto. Prueba de handler y visual desktop/movil. Productos activos se cuentan de forma distinta por producto, no por fila de stock. |
| RI-005 | Historico GET devuelve distribuciones por item y dashboard muestra lote, cantidad, condicion, ubicacion y motivo. | No se multiplican filas padre ni totales; conserva fallback de registros antiguos. SQL real y prueba visual con tres distribuciones. |
| RI-007 | Pendiente se renombra Sin asignar. | No cambia calculo ni confirmacion del despacho. Comprobado visualmente. |
| P-017 | Aviso de liberacion al alistador incluye nombre del material. | Cambio de texto local; aviso real pendiente, no reenviado. |
| Busquedas | Una respuesta antigua no vuelve a poblar el resultado al cambiar de producto a lote. | Carrera simulada con respuesta demorada, desktop/movil. |

## Novedades que impiden declarar todo cerrado

1. **Filtro general MP/PT**: SQL muestra 79 productos activos con `tipo_producto=Product`: 49 sin modalidad, 21 PR, 3 PT y 6 IO. La consulta general usa MP/PT y devuelve cero filas para MP. La consulta por SKU si funciona. Es un problema previo (el codigo anterior tambien filtraba MP/PT), detectado al ejecutar la lectura nueva. No se recategorizo la base ni se invento una taxonomia. Corregir usando la clasificacion operativa acordada y probar el listado antes de aceptacion integral.
2. **Mismo lote proveedor con condiciones distintas**: el normalizador actual rechaza asignar DISPONIBLE y CUARENTENA/RECHAZADO al mismo identificador de lote. El caso 3/1/1 validado usa lotes distintos; NO prueba ese escenario comun de una entrega parcialmente danada. No inventar lotes proveedor para eludirlo. Necesita una decision/implementacion explicita de segregacion interna conservando el lote original. Mantener como riesgo de cobertura, no cambiar esa logica incidentalmente.
3. **Interpretacion real**: las instrucciones nuevas solo estan en `docs/Prompt WMS.txt`. Ninguna prueba local demuestra que BBC clasifique correctamente audios/parafrasis. Tres casos dirigidos pendientes: recepcion segregada, retorno MP natural y solicitud de destruccion deshabilitada.
4. **Cobertura no ejecutada**: concurrencia real, aviso real al alistador, alias ambiguos con candidatos, consulta de OC ya recibida, etiquetas tecnicas de rechazo PDF y los casos de UI/impresion pendientes del consolidado no se dan por cerrados con este pase.

## Orden para evitar reprocesos

1. Resolver el filtro general de catalogo y acordar el tratamiento de lote compartido entre condiciones sin alterar los PDF ya aprobados.
2. Revisar y publicar un conjunto coherente de backend/frontend; despues sincronizar solo el prompt operativo de BBC. No tocar Documentos ni sus limites/proveedor en este cambio.
3. Con autorizacion explicita, ejecutar los tres mensajes dirigidos, cotejar logs/SQL/dashboard y registrar roles y hora. No volver a cargar PDF ya validados sin necesidad.
4. Solo cuando estos controles pasen, congelar version/prompt y repetir la bateria integral, manteniendo separados flujos reales, simulaciones y controles internos. No prometer una bateria sin errores por haber pasado pruebas automatizadas.

Fuentes: `consolidado-pruebas-y-pendientes-2026-09-06.md`, `bateria-integral-2026-09-06.md`, `validacion-extraccion-pdf-2026-09-06.md` y `bitacora-pruebas-manuales-2026-09.md`.
