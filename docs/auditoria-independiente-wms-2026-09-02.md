# Auditoría independiente de seguridad e integridad WMS

**Fecha:** 2026-09-02  
**Modo:** Deep  
**Alcance:** working tree local del repositorio WMS  
**Resultado ejecutivo:** **NO-GO para exponer a Internet las rutas mutantes de BuilderBot y SIIGO hasta corregir F-01 y F-02.**

## Alcance y metodología

La revisión priorizó pérdida potencial, exposición, autenticación, autorización, integridad de inventario, trazabilidad, concurrencia, idempotencia, integraciones y recuperación.

Áreas inspeccionadas:

- API serverless bajo `api/v1` y servicios de dominio en `api/_lib`.
- Autenticación JWT, capacidades y roles.
- Recepción, producción, despachos, devoluciones y aprobaciones.
- Integraciones con BuilderBot y SIIGO.
- Esquema MySQL, migraciones y configuración de despliegue.
- Suite local de pruebas y cobertura estática relevante.

Comprobaciones realizadas:

- `npm test`: 172 pruebas aprobadas, 0 fallidas.
- `node --check`: 122 archivos JavaScript válidos, 0 fallidos.
- Revisión manual de rutas mutantes, límites de confianza y consultas SQL.
- Revisión no destructiva de nombres de archivos sensibles y configuración.

No se accedió a BuilderBot, SIIGO, Vercel, MySQL live ni otros sistemas externos. No se ejecutaron pruebas E2E/live, `npm audit` ni un build que generara artefactos.

## Resumen de riesgo

| ID | Severidad | Probabilidad | Pérdida principal | Estado |
|---|---|---:|---|---|
| F-01 | Crítica | Alta si está desplegado | Stock y conciliación falsificados | Abierto; despliegue no verificado |
| F-02 | Crítica | Media-alta | Impersonación operativa | Abierto; configuración live no verificada |
| F-03 | Alta | Media | Invariantes y trazabilidad omitidas | Abierto |
| F-04 | Alta | Media-alta | Duplicación por reintentos | Abierto |
| F-05 | Alta | Media | Inflación autorizada de inventario | Abierto; requiere política |
| F-06 | Alta | Alta ante recuperación | Entorno y BD irreproducibles | Abierto |
| F-07 | Media | Media | Toma de cuentas o sesiones | Abierto |
| F-08 | Media | Alta ocurrencia | Exposición de PII | Abierto |
| F-09 | Media | Media | Mensajería accidental | Abierto |
| F-10 | Media | Alta exposición | Reconocimiento interno | Abierto |

## Hallazgos

### F-01 — Crítico: webhooks SIIGO permiten falsificación y replay de inventario

- **Ubicación:** `api/v1/webhook/siigo-credit-notes.js:11`, `api/v1/webhook/siigo-invoices.js:9`, `api/v1/webhook/siigo-purchases.js:11`, `api/v1/webhook/siigo-products.js:14`, `database/schema.sql:355`.
- **Impacto:** inflación remota y repetible de existencias, trazabilidad incorrecta, despachos respaldados por inventario inexistente y conciliación financiera errónea.
- **Evidencia:** facturas, compras y notas crédito validan sólo un `Partner-Id`, y únicamente cuando `NODE_ENV` es producción. El webhook de productos sí usa un secreto con comparación segura. Las notas crédito incrementan el primer stock coincidente sin exigir lote, ubicación ni correspondencia con el despacho original. Tampoco existe deduplicación persistente ni una restricción única para el evento externo.
- **Probabilidad:** alta si las rutas están desplegadas y suscritas. Ese estado live no se verificó.
- **Recomendación:** desactivar con 404 las rutas débiles o exigir firma HMAC sobre el cuerpo exacto, timestamp, event ID y protección de replay. No usar `Partner-Id` como autenticador.
- **Criterio de aceptación:** firma obligatoria; ventana temporal; nonce/event ID único; nota crédito ligada a despacho, producto, lote y cantidad originales; replay concurrente sin segundo movimiento; pruebas negativas para firma ausente, inválida y expirada.

### F-02 — Crítico: BuilderBot admite una credencial secundaria y confía en un teléfono controlado por el remitente

- **Ubicación:** `api/_lib/auth.js:71`, `api/v1/webhook/builderbot.js:219`, `api/v1/webhook/builderbot.js:602`, `api/v1/webhook/builderbot.js:1252`, `api/v1/webhook/builderbot.js:1326`.
- **Impacto:** impersonación de usuarios y ejecución de operaciones de recepción, producción, despacho, merma, devolución o aprobación según el rol suplantado.
- **Evidencia:** el middleware común exige correctamente un secreto, pero el handler captura el fallo y permite una credencial secundaria incluida en el payload. La identidad se obtiene del campo `from` del mismo cuerpo y se resuelve directamente contra usuarios activos. El RBAC posterior autoriza al rol encontrado, pero no demuestra que el emisor sea dueño del teléfono.
- **Supuesto de severidad:** la explotación depende de que la ruta esté desplegada y el atacante conozca un número válido. La combinación con una ruta pública y una credencial débil justifica severidad crítica.
- **Recomendación:** eliminar la compatibilidad por palabra clave, rotar las credenciales relacionadas y aceptar sólo eventos firmados por el proveedor.
- **Criterio de aceptación:** ningún campo del body autentica la solicitud; firma ligada a cuerpo, timestamp y event ID; identidad derivada de datos firmados; alteración de `from`, `action` o `params` rechazada; fallos con HTTP 401/403.

### F-03 — Alto: aprobaciones heredadas evitan invariantes modernas

- **Ubicación:** `api/_lib/capabilities.js:48`, `api/v1/approvals/approve.js:206`, `api/v1/approvals/approve.js:309`, `api/v1/approvals/approve.js:361`, `api/v1/approvals/approve.js:442`, `api/v1/approvals/approve.js:556`.
- **Impacto:** despacho de vencidos, stock sin ubicación, producción sin trazabilidad material completa y despachos sin la política SIIGO vigente.
- **Evidencia:** la ruta sigue activa para roles privilegiados y reimplementa inicio/cierre de producción y despacho. El inicio no aplica el plan FEFO moderno por lotes y ubicaciones; el cierre no reproduce la reconciliación, ubicación y vencimiento derivados; el despacho no excluye vencidos y permite salida directa.
- **Recomendación:** congelar nuevas aprobaciones heredadas, migrar las pendientes y delegar exclusivamente en los servicios modernos.
- **Criterio de aceptación:** dashboard, BuilderBot y aprobaciones producen exactamente las mismas validaciones, movimientos, lotes y Kardex; no quedan implementaciones paralelas.

### F-04 — Alto: liberación y ajustes de producción no son idempotentes

- **Ubicación:** `api/_lib/production-workflow.js:29`, `api/_lib/production-workflow.js:101`, `api/v1/production/start.js:12`, `api/_lib/production-materials.js:11`, `api/v1/production/material-adjustment.js:12`.
- **Impacto:** doble reserva, doble consumo o incremento duplicado por doble clic, timeout o retry.
- **Evidencia:** liberar producción abre una transacción y bloquea stock, pero cada llamada crea una OP nueva y vuelve a reservar materiales. Los ajustes `ENTREGA_ADICIONAL` y `DEVOLUCION` tampoco tienen identidad persistente de operación.
- **Recomendación:** clave idempotente obligatoria, índice único y hash canónico del payload.
- **Criterio de aceptación:** misma clave y mismo payload devuelven el resultado original; misma clave con payload diferente responde 409; solicitudes concurrentes producen una sola mutación.

### F-05 — Alto: faltan límites de rendimiento y tolerancias de sobrantes

- **Ubicación:** `api/_lib/production-close.js:114`, `api/_lib/production-close.js:171`, `api/v1/reception.js:154`, `api/v1/reception.js:218`, `api/v1/reception.js:453`.
- **Impacto:** aumento autorizado pero no controlado de inventario, pérdida de correspondencia con OC/BOM y riesgo de fraude o error operativo.
- **Evidencia:** el cierre moderno valida cantidades no negativas, pero no compara unidades conformes o merma con la cantidad planeada. En recepción distribuida, un sobrante puede ingresar completo como disponible. En el fallback simple, la cantidad aceptada puede superar la esperada y ocultar el sobrante si coincide con la cantidad buena.
- **Recomendación:** definir tolerancias por SKU y proceso; colocar excesos en cuarentena o exigir segunda aprobación.
- **Criterio de aceptación:** ninguna cantidad superior al documento o rendimiento permitido entra a disponible sin novedad y aprobación explícitas; se conserva actor, motivo y evidencia.

### F-06 — Alto: el esquema no es reproducible desde una instalación limpia

- **Ubicación:** `docker-compose.yml:16`, `database/03_produccion_tables.sql:1`, `README.md:110`, `backend/package.json:6`, `backend/src/config/migrate.js:7`.
- **Impacto:** restauraciones incompletas, entornos divergentes, despliegues inseguros y mayor tiempo de recuperación.
- **Evidencia:** Docker referencia directorios sin Dockerfiles y sólo monta `database/schema.sql`; las tablas operativas posteriores viven en archivos separados. El README ordena un script inexistente y el migrador disponible ejecuta sólo el esquema base, sin tabla de versiones.
- **Recomendación:** migrador único, ordenado, versionado y repetible, acompañado por una instalación limpia automatizada.
- **Criterio de aceptación:** una BD vacía alcanza el esquema esperado mediante un comando; cada migración registra versión, checksum y estado; existe ensayo automatizado de restauración.

### F-07 — Medio: autenticación sin protección contra fuerza bruta y refresh tokens no revocables

- **Ubicación:** `api/v1/auth/login.js:20`, `api/v1/auth/login.js:43`, `api/v1/auth/refresh.js:18`, `frontend/src/store/authStore.js:10`.
- **Impacto:** mayor probabilidad de toma de cuentas y persistencia de sesiones robadas.
- **Evidencia:** el login no aplica rate limiting, bloqueo progresivo ni alerta específica. Los access tokens duran ocho horas por defecto; el refresh token dura siete días y carece de rotación, `jti`, almacenamiento o revocación individual. El frontend usa `sessionStorage`, mejor que `localStorage`, pero accesible desde JavaScript.
- **Recomendación:** limitación por IP/cuenta, backoff y alertas; rotación y revocación de refresh o eliminación del mecanismo si no se usa; CSP y menor duración del access token.
- **Criterio de aceptación:** pruebas de abuso, revocación y reutilización de refresh; alertas y límites documentados.

### F-08 — Medio: PII y contenido operativo se conservan en logs

- **Ubicación:** `api/v1/webhook/builderbot.js:432`, `api/v1/webhook/builderbot.js:467`, `api/v1/webhook/builderbot.js:1283`, `api/v1/webhook/logs.js:23`, `api/_lib/siigo.service.js:147`, `api/_lib/siigo.service.js:255`.
- **Impacto:** exposición de teléfonos, clientes, proveedores, documentos y conversaciones ante acceso indebido a logs o cuentas administrativas.
- **Evidencia:** el webhook registra teléfono, payload y respuesta; la sanitización sólo especializa algunos flujos. El endpoint administrativo devuelve teléfono y vistas parciales. SIIGO almacena cuerpos completos salvo campos cuyos nombres parecen credenciales.
- **Recomendación:** enmascarar desde el origen, usar allowlist de campos, desactivar cuerpos por defecto, establecer retención y auditar accesos.
- **Criterio de aceptación:** pruebas que confirmen que PII y credenciales no llegan a consola ni base de datos.

### F-09 — Medio: las notificaciones salen habilitadas por defecto pese a documentación contraria

- **Ubicación:** `api/_lib/builderbot-notifications.js:14`, `docs/builderbot-agent-map.md:186`, `api/v1/notifications.js:6`.
- **Impacto:** mensajes reales enviados accidentalmente durante pruebas o despliegues mal configurados.
- **Evidencia:** el código considera habilitados los envíos salvo un interruptor negativo explícito, mientras la guía presenta otra variable como control seguro inicial. Además, reintentar una notificación usa una capacidad denominada de lectura de logs.
- **Recomendación:** un único flag positivo, default-off, y una capacidad separada para reintentos.
- **Criterio de aceptación:** cero tráfico externo sin habilitación explícita; configuración incoherente impide iniciar; `notifications.retry` separada de lectura.

### F-10 — Medio: el health check público revela estructura y errores internos

- **Ubicación:** `api/v1/health.js:1`, `api/v1/health.js:31`, `api/v1/health.js:43`, `api/v1/health.js:66`.
- **Impacto:** reconocimiento de infraestructura, esquema y actividad interna.
- **Evidencia:** el endpoint público devuelve errores de conexión, existencia y número de columnas de tablas e identificadores recientes de lote y Kardex.
- **Recomendación:** limitar la respuesta pública a `ok/status` y autenticar diagnósticos detallados.
- **Criterio de aceptación:** el endpoint público nunca devuelve mensajes SQL, nombres de tablas, conteos de columnas ni identificadores internos.

## Controles positivos observados

- Consultas mayoritariamente parametrizadas.
- Transacciones y bloqueos `FOR UPDATE` en los flujos modernos más importantes.
- FEFO moderno que excluye lotes vencidos e inventario en ubicaciones inactivas.
- Capacidades verificadas en servidor y roles desconocidos sin mutación.
- Idempotencia implementada en recepción, cierre, documentos y algunos flujos 3Q.
- Tokens del frontend en `sessionStorage`, no en `localStorage`.

Estos controles reducen el riesgo, pero no compensan rutas paralelas que los evitan.

## Vacíos de verificación

- No existen pruebas dirigidas a nota crédito SIIGO, `Partner-Id`, replay, ajuste de materiales, sobreproducción, sobre-recepción o rate limiting.
- Varias pruebas comprueban expresiones sobre el código fuente y no ejecutan la transacción real contra MySQL.
- No se probaron concurrencia, rollback, migración limpia ni restauración de backup.
- Las vulnerabilidades actuales de dependencias no se verificaron por no usar acceso de red.
- No se verificaron secretos, flags, usuarios, roles, WAF, suscripciones o retención en producción.

## Plan recomendado

### 0–24 horas

1. Bloquear los webhooks SIIGO débiles.
2. Eliminar la autenticación secundaria de BuilderBot.
3. Deshabilitar explícitamente notificaciones salientes.
4. Impedir nuevas aprobaciones por la ruta heredada.
5. Reducir el health público.
6. Rotar credenciales relacionadas después del despliegue.

### 2–5 días

1. Implementar firma, timestamp, event ID e idempotencia en webhooks.
2. Añadir idempotencia a liberación y ajustes de producción.
3. Enmascarar y reducir logs.
4. Incorporar rate limiting y alertas de autenticación.
5. Añadir pruebas de replay, doble clic y concurrencia.

### 1–2 sprints

1. Centralizar toda mutación en servicios de dominio únicos.
2. Definir tolerancias de producción y recepción con aprobaciones de excepción.
3. Implementar migraciones versionadas y verificables desde una BD vacía.
4. Añadir restricciones DB para saldos, reservas y documentos externos únicos.
5. Crear una suite de integración MySQL y pruebas periódicas de recuperación.

## Decisiones de negocio pendientes

1. Mantener webhooks SIIGO o sustituirlos por polling autenticado.
2. Definir tolerancias de sobreproducción, faltantes y sobrantes por SKU.
3. Decidir si los excesos van a cuarentena o a segunda aprobación.
4. Establecer fecha límite para retirar roles heredados.
5. Definir retención de payloads, teléfonos, facturas y respuestas SIIGO.
6. Determinar quién puede habilitar notificaciones reales y reintentar mensajes.

## Conclusión

La prioridad no es una refactorización cosmética: es cerrar las dos vías de suplantación o falsificación remota, retirar las mutaciones heredadas y garantizar idempotencia y límites de negocio. Hasta entonces, el riesgo residual sobre inventario real sigue siendo alto aunque la suite local esté en verde.
