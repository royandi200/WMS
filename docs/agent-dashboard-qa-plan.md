# Plan QA agente BuilderBot y dashboard

Este plan usa productos reales Infinity ya cargados en `productos`/`skus`. El resto de datos son fixtures de prueba marcados como `TEST_AGENT`.

## Fixtures aplicados

Archivo reproducible:

- `database/06_test_fixtures_infinity_agent.sql`

Escenarios creados:

- BOM temporal para `00102-PTASH60` y `00110-PTCG120`.
- Stock disponible para materias primas, empaques y producto terminado.
- Lote vencido: `TEST_AGENT-MPASH-EXPIRED`.
- Lote en cuarentena: `TEST_AGENT-MPCG-CUARENTENA`.
- Stock bajo:
  - `00022-ETCG120`, minimo 80, disponible 75.
  - `00030-ETCG140`, minimo 50, disponible 12.
- Ordenes:
  - `OP-TEST-ASH-PLAN`, `PLANEADA`.
  - `OP-TEST-CG-PROC`, `EN_PROCESO`.
  - `OP-TEST-ASH-CERR`, `CERRADA`.
- Solicitudes pendientes:
  - `REQ-900001`, inicio de produccion.
  - `REQ-900002`, despacho.

## Productos usados

| Uso | SKU | Nombre |
| --- | --- | --- |
| PT Ashwagandha | `00102-PTASH60` | PRODUCTO TERMINADO ASHWAGANDHA X 60 |
| PT Creagums | `00110-PTCG120` | PRODUCTO TERMINADO CREAGUMS X 120G |
| Base Ashwagandha | `00051-MPASH` | GOMAS ASHWAGANDHA -MAGNESIO Y VITAMINA C |
| Base Creagums | `00052-MPCG` | GOMAS CREAGUMS - CREATINA CREAPURE |
| Tarro | `00007-TRG` | TARRO GRANDE PRICESMART x 120 |
| Tapa | `00004-TPALB` | TAPA AZUL ASHWAGHANDA LINEA BLANCA x 60 |
| Etiqueta Ashwagandha | `00017-ETASH60` | ETIQUETA ASHWAGANDHA x 60 |
| Etiqueta Creagums | `00022-ETCG120` | ETIQUETA CREAGUMS x 120 |
| Stock bajo | `00030-ETCG140` | ETIQUETA CREAGUMS x 140 |

## Pruebas del agente

Ejecutar desde WhatsApp/BuilderBot. En cada caso revisar que el usuario reciba texto real, no `{mensaje}`.

| Caso | Frase | Esperado |
| --- | --- | --- |
| Saludo | `hola` | Respuesta de ayuda general del WMS. |
| Stock MP | `cuanto hay de gomas ashwagandha` | Stock de `00051-MPASH` con FIFO y alerta de lote vencido. |
| Stock PT | `cuanto producto terminado hay de ashwagandha x 60` | Stock de `00102-PTASH60`, lote `TEST_AGENT-PTASH-DISP`. |
| Capacidad suficiente | `puedo fabricar 50 ashwagandha x 60` | Capacidad positiva para `00102-PTASH60`. |
| Capacidad insuficiente | `puedo fabricar 1000 creagums 120` | Debe indicar faltantes por BOM/stock. |
| Inicio produccion | `inicia produccion de 20 ashwagandha x 60` | Crea orden y solicitud `REQ-...`, si hay stock suficiente. |
| Aprobar fixture | `apruebo REQ-900001` | Orden `OP-TEST-ASH-PLAN` pasa a `APROBADA` y reserva materiales. |
| Confirmar materiales | `confirmo materiales orden OP-TEST-ASH-PLAN` | Orden pasa a `EN_PROCESO`, descuenta insumos. |
| Avance fase | `avanza la orden OP-TEST-CG-PROC a F3` | Actualiza fase de la orden en proceso. |
| Merma por orden | `merma 3 gomas creagums en la orden OP-TEST-CG-PROC por prueba de calidad` | Registra merma de proceso. |
| Cierre produccion | `cerramos produccion OP-TEST-CG-PROC con 77 unidades` | Crea solicitud de cierre para aprobacion. |
| Despacho FIFO | `despacha 10 creagums 120 para Cliente QA` | Crea solicitud de despacho usando FIFO. |
| Aprobar despacho fixture | `apruebo REQ-900002` | Descuenta `TEST_AGENT-PTCG-DISP` en 5 unidades. |
| Devolucion cuarentena | `devolucion de 5 ashwagandha x 60 de Cliente QA en cuarentena` | Crea devolucion y lote en cuarentena. |
| Trazabilidad lote | `trazabilidad del lote TEST_AGENT-PTASH-DISP` | Historial del lote con kardex. |
| Excepcion picking | `no pude usar el lote TEST_AGENT-MPASH-FIFO-OLD use TEST_AGENT-MPASH-FIFO-NEW` | Registra excepcion en logs. |
| Solicitudes pendientes | `que solicitudes pendientes hay` | Supervisor/admin debe ver `REQ-900001` y `REQ-900002` si no se han procesado. |

## Ajustes esperados del prompt

Durante las pruebas, ajustar `docs/Prompt WMS.txt` si el LLM no mapea bien lenguaje natural a SKU.

Prioridad de sinonimos:

- "ashwagandha x 60" -> `00102-PTASH60`
- "creagums 120" -> `00110-PTCG120`
- "gomas ashwagandha" -> `00051-MPASH`
- "gomas creagums" -> `00052-MPCG`
- "tarro grande" -> `00007-TRG`
- "etiqueta creagums" -> `00022-ETCG120`

## Pruebas del dashboard

Usar los mismos datos `TEST_AGENT`.

| Modulo | Accion | Esperado |
| --- | --- | --- |
| Login | Entrar con usuario valido | Dashboard carga y conserva sesion. |
| Inventario - Resumen | Abrir resumen | Debe reflejar stock/lotes nuevos. |
| Inventario - Stock Bajo | Abrir stock bajo | Deben aparecer `00022-ETCG120` y `00030-ETCG140`. |
| Inventario - Buscar Producto | Buscar `00102-PTASH60` | Debe mostrar producto, total y lote `TEST_AGENT-PTASH-DISP`. |
| Inventario - Buscar Producto | Buscar `00051-MPASH` | Debe mostrar lotes FIFO y vencido. |
| Inventario - Buscar Lote | Buscar `TEST_AGENT-MPASH-EXPIRED` | Debe mostrar producto, cantidad y vencimiento. |
| Inventario - Buscar Lote | Buscar `TEST_AGENT-MPCG-CUARENTENA` | Debe mostrar estado cuarentena. |
| Inventario - Mapa Bodega | Abrir mapa | Debe renderizar sin errores y con datos demo/stock. |
| Kardex | Buscar `00102-PTASH60` | Debe mostrar movimientos `TEST_AGENT`. |
| Produccion | Listar ordenes | Deben aparecer `OP-TEST-*` en estados diferentes. |
| Recepciones | Listar/buscar | Debe aparecer `REC-TEST-AGENT-001`. |
| Despachos | Listar/buscar | Debe aparecer `DSP-TEST-AGENT-001`. |
| Devoluciones | Listar/buscar | Debe aparecer `DEV-TEST-AGENT-001`. |
| Aprobaciones | Consultar pendientes | Deben aparecer `REQ-900001` y `REQ-900002` mientras no se procesen. |

## Criterios de exito

- BuilderBot nunca muestra `{mensaje}`.
- Toda respuesta API contiene `mensaje` y `message`.
- Los handlers escriben en BD sin errores.
- Stock nunca queda negativo.
- Las aprobaciones cambian de estado una sola vez.
- Dashboard no recibe HTML en respuestas API.
- Dashboard muestra datos `TEST_AGENT` en las pantallas indicadas.

## Reinicio de datos

El SQL es idempotente. Para reiniciar escenarios, volver a ejecutar:

```sql
SOURCE database/06_test_fixtures_infinity_agent.sql;
```

Esto limpia y recrea solo datos `TEST_AGENT`.
