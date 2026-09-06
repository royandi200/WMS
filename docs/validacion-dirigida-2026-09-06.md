# Validacion dirigida posterior a arreglos

Fecha: 2026-09-06. Horas en America/Bogota.
Aplicacion: main, implementacion 9bbd5ac, documentacion b511e43.
Objetivo: comprobar los arreglos recientes antes del ensayo integral con cliente.

## Configuracion comprobada

- Juan: admin; Datana: recepcion_cierre; Jobana: alistador.
- Tres sesiones WhatsApp y dashboard disponibles.
- Consulta SQL inicial interrumpida por ECONNRESET; conexion recuperada antes de pruebas operativas.
- Las cargas manuales de PDF quedan al final, con aviso previo al usuario.
- Leer cada respuesta completa y desplegar Read more/Leer mas cuando aparezca.

## Resultados

### D01 - Alias exacto, ambiguedad y lotes agotados

- Hora: 12:23-12:24.
- Canal: WhatsApp Juan/admin.
- Entrada: `Cuanto stock hay de tapas blancas 60?`.
- Resultado: 00001-TPBI, disponible 6 und, lote QA-RX-0905-TPBI, ubicacion A8, vence 2027-12-31; encabezado FEFO.
- SQL: un lote con 6 und y reserva 0; dos lotes con saldo 0 excluidos de la respuesta.
- Entrada ambigua: `Cuanto stock hay de tapas?`.
- Resultado: pide escoger entre cinco presentaciones; no selecciona arbitrariamente.
- Estado: APROBADA. Pendiente de UX menor: candidatos redactados en un parrafo; lista vertical seria mas legible.

### D02 - Trazabilidad y Kardex

- Hora: 12:25. WhatsApp admin, lote TEST_AGENT-MPASH-FIFO-NEW; respuesta desplegada completa con Read more. Los 18 movimientos reconstruyen el saldo hasta 0.
- La paginacion conversacional sigue pendiente: este caso no genero varias paginas.
- Hallazgo: Kardex convertia UUID de lote a Number, por lo que no recalculaba saldos historicos por lote. Ejemplo SQL: merma QA-RX-0905-MPASH, saldo legacy 8540.1 frente a saldo de lote 1995.
- Correccion local: conservar UUID como cadena. Prueba del endpoint con dos lotes independientes verifica saldo 1995 y 7, sin mezclar producto.
- Pendiente: repetir visualmente tras despliegue.

### D03 - Trazabilidad inversa 3Q

- Hora: 12:26-12:28. WhatsApp admin, lote RECINT-64-90-01, respuesta completa desplegada.
- FALLO: mostraba envio a orden 5, pero omitia dos recepciones de PT existentes. Ademas incluia una orden cancelada sin envio confirmado.
- Causa comprobada: consulta utilizaba recepcion_distribuciones.producto_id, columna inexistente; catch ocultaba el error como ausencia de recepciones.
- Correccion local: unir recepcion_items con distribuciones por recepcion_item_id, filtrar recepciones completadas y envios confirmados del mismo producto. No silenciar fallos SQL.
- SQL corregido comprobado en lectura: REC-3Q-5-001 y REC-3Q-5-002, 2 und cada una, lotes MAN-034-3Q-BOS60-001 y MAN-035-3Q-BOS60-002.
- Pendiente: repetir por WhatsApp despues del despliegue.

### D04 - Corregir y descartar borrador 3Q

- Hora: 12:25-12:29. Dashboard Admin WMS.
- Documento ID 12 R04: restaurada fila 00026-ETRES120 por 29 und contrastada con PDF original. Paso de 8 filas/192 und a 9 filas/221 und; PENDIENTE_REVISION.
- Auditoria conserva antes/despues, motivo, actor y fecha. PDF original conservado sin cambios (3723 bytes y mismo SHA256).
- Documento QA anterior ID 9 R02 descartado con motivo y confirmacion. SQL: DESCARTADO, PDF retenido.
- Antes/despues: kardex 298, movimientos 307, ordenes maquila 4; checksum numerico de stock 21446.4850 y reservas 1072.8000 sin cambios. Checksums no son totales operativos porque mezclan unidades.
- Estado: APROBADA para correccion, descarte logico y ausencia de movimiento de inventario.

### Regresion automatizada tras hallazgos

- Suite local: 232 pruebas aprobadas, 0 fallidas. Incluye nueva prueba de endpoint con UUID.
- Esto no sustituye la repeticion en WhatsApp/dashboard ni acredita los casos aun pendientes.

## Pendientes de esta corrida

- D02: trazabilidad extensa, todas sus paginas y saldos por lote.
- D03: trazabilidad bidireccional de maquila 3Q.
- D04: correccion y descarte de borrador 3Q, auditoria e inventario sin cambios.
- D05: confirmacion de OP adicional y reintento.
- D06: confirmacion de merma adicional y reintento.
- D07: confirmacion de devolucion adicional y reintento.
- D08: KPI de recepciones fisicas unicas.
- D09: PDF OC y remision 3Q nuevos, exactitud y revision humana (carga manual).
