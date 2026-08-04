# Validacion interna E2E - 2026-08-04

## Alcance ejecutado

La validacion se ejecuto contra la base QA conectada al WMS. Las operaciones usan referencias `WMSFLOW-*`, notificaciones salientes desactivadas y usuarios de prueba. No se eliminaron movimientos ni se alteraron documentos contables reales.

## Resultado por capa

| Capa | Resultado | Evidencia principal |
|---|---|---|
| Contratos y capacidades | Aprobado | 14 pruebas Node |
| Frontend | Aprobado | Build Vite, 1526 modulos |
| Preflight MySQL | Aprobado | Lineas, roles, ubicaciones, BOM, FEFO e invariantes |
| Recepcion | Aprobado | OC/factura QA, 3 disponibles, 1 cuarentena, 1 rechazo, reintento idempotente |
| Produccion | Aprobado | OP 3 planeadas, 2 conformes, 1 merma, cuatro materiales, ajuste neto 0.15 e idempotencia |
| Despacho | Aprobado | Factura QA, reserva FEFO, descuento de 1 y reintento sin segundo descuento |
| Devoluciones | Aprobado | Recuperable, cuarentena y destruccion segregadas |
| Merma de lote | Aprobado | Descuento 0.25 en stock y lote; exceso rechazado con 409 |
| RBAC | Aprobado | 12 controles con rotacion de roles y restauracion automatica |
| Webhook local | Aprobado | Saludo, stock, trazabilidad, capacidad y rechazo sin credencial |
| APIs dashboard desplegadas | Aprobado, 20/20 | Notificaciones corregida y revalidada en Vercel |
| Webhook desplegado | Aprobado | Saludo, stock, trazabilidad, capacidad maxima y rechazo sin credencial |
| Dependencias backend | Aprobado | 0 vulnerabilidades npm de produccion |

## Operaciones QA verificadas

- Recepcion `REC-SIIGO-FC-WMSFLOW-1785879`: completada y no duplicada.
- Produccion `OP-20260804-000059`: `CERRADA`, lote `LPN-OP-20260804-000059`, 2 disponibles y merma 1.
- Despacho `DSP-SIIGO-FV-WMSFLOW-1785879`: `despachado`, lote FEFO descontado exactamente una vez.
- Devoluciones: solo `RECUPERABLE` aumento stock; `CUARENTENA` y `DESTRUCCION` quedaron no disponibles.
- Merma directa: stock y `lots.qty_current` bajaron de 1 a 0.75.

## Defectos encontrados y corregidos

1. El endpoint directo de despacho ignoraba `ALLOW_DIRECT_DISPATCH_REQUEST=false`. Ahora devuelve 409 antes de tocar inventario.
2. `GET /api/v1/notifications` usaba un parametro preparado en `LIMIT`, incompatible con el MySQL actual. Ahora interpola solo el entero previamente acotado.
3. Una devolucion para destruccion intentaba guardar `DESTRUCCION` en un enum de lote que ya no lo admite. La devolucion conserva esa disposicion y el lote usa `PENDIENTE_DISPOSICION`.
4. Se aplico `database/11_return_lot_statuses.sql`; reparo dos lotes historicos afectados.
5. Capacidad de fabricacion fallaba con parametros ausentes y solo respondia frente a una cantidad propuesta. Ahora acepta `id_item`, valida entradas y calcula el maximo fabricable cuando no se indica cantidad.
6. Los runners QA dejaban procesos Node abiertos por el pool compartido. Ahora terminan de forma determinista.

## Invariantes finales exigidas

- Cero stock negativo.
- Cero reservas negativas.
- Cero reservas superiores al stock.
- Cero facturas o compras QA duplicadas por identificador Siigo.
- Lotes QA disponibles conciliados con `stock`.
- Lotes devueltos con estado fisico valido.
- Rol de la linea rotativa restaurado a `recepcion_cierre`.

## Riesgos residuales

- El webhook conserva autenticacion de respaldo por `kw=g0m@s`. Funciona para BuilderBot, pero debe sustituirse por secreto o firma obligatoria antes de produccion.
- El login no tiene rate limiting.
- El health publico expone mas detalle interno del necesario.
- Debe exigirse validacion estricta del certificado TLS de MySQL.
- `react-router` reporta un advisory alto para RSC Mode. El dashboard usa `BrowserRouter` declarativo y no RSC; no se identifico una ruta alcanzable, pero debe actualizarse cuando exista una version corregida compatible.

## Lo que todavia requiere prueba manual

- Comprension del LLM con lenguaje libre, audios, correcciones y contexto conversacional.
- Entrega real de notificaciones a las dos lineas WhatsApp y deduplicacion visible en BBC.
- Recorrido visual responsivo y ergonomia de cada pagina del dashboard.
- Polling de documentos creados realmente en Siigo sandbox durante la misma ventana de prueba.
- Confirmacion humana de textos, cantidades, ubicaciones y excepciones operativas.

La garantia interna cubre reglas de dominio, persistencia, autorizacion, idempotencia y contratos API probados. No sustituye las pruebas manuales de interfaz, LLM, red de WhatsApp ni comportamiento del sandbox de terceros.

## Despliegue validado

- Commit: `8042f45`.
- Rama: `main`.
- URL: `https://wms-seven-ebon.vercel.app`.
- Dashboard API: 20 de 20 rutas aprobadas despues del deployment.
- Webhook API: 5 de 5 controles aprobados contra Vercel.
- Prompt BBC sincronizado por MCP en Entrada y Voz; ambos hashes coinciden exactamente con `docs/Prompt WMS.txt` (`f6368136...f4cb9c2c`).
