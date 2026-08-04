# Conexiones e integraciones externas del WMS

Última actualización: 2026-08-04

## Objetivo

Runbook para conectar, diagnosticar y operar servicios externos sin exponer secretos. Los valores reales deben vivir en variables de entorno de Vercel o en archivos locales ignorados por Git.

## Matriz de conexiones

| Sistema | Dirección | Uso | Autenticación |
| --- | --- | --- | --- |
| BuilderBot -> WMS | Entrante | Mensajes WhatsApp y acciones del agente | `X-BuilderBot-Secret`; fallback `kw` temporal |
| WMS -> BuilderBot | Saliente | Notificaciones proactivas por WhatsApp | API key del bot |
| IA/Codex -> BBC MCP | Administración | Leer flujos y sincronizar prompts | API key Manager global |
| WMS -> MySQL | Bidireccional | Datos operativos y transacciones | Usuario/contraseña DB y TLS opcional |
| MCP local -> MySQL | Solo lectura | Diagnóstico asistido | Variables `MYSQL_*` |
| WMS -> Siigo | Saliente | Auth, catálogo, compras, ventas y consultas | Usuario API, access key y Partner-Id |
| Siigo -> WMS | Entrante | Webhooks opcionales | Secreto de webhook |
| GitHub -> Vercel | Despliegue | Publicar `main` | Integración de cuenta/proyecto |

## BuilderBot Cloud

### Proyecto activo

```text
Nombre: Bodega Inventarios
Project ID: 5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d
```

Flujos comprobados el 2026-08-04:

| Flujo | Evento | Flow ID | Answer ID |
| --- | --- | --- | --- |
| Entrada | `EVENTS.WELCOME` | `fa49edb8-5ecb-414c-b4d6-aa005ed19343` | `b4e6d905-70c6-4a30-a519-e3eb7e0adcce` |
| Voz | `EVENTS.VOICE_NOTE` | `79ce1f41-00f7-45ba-a3f3-8f042aebe0a4` | `bca07485-2ad1-449c-aa38-3b851b57f79c` |
| Salida | `EVENTS.ACTION` | `b2f0efac-6ecd-4133-ae42-9869496feb1c` | `6a45016f-accf-410c-a6bd-9c7118456918` |

Entrada y Voz usan `docs/Prompt WMS.txt`. Voz redirige a Salida. Entrada conserva la regla `body includes g0m@s` hacia Salida.

### Flujo funcional

```text
WhatsApp -> BBC -> LLM clasificador -> {aiResponse}
         -> POST WMS /api/v1/webhook/builderbot
         -> respuesta JSON { mensaje, message }
         -> BBC muestra {mensaje} en WhatsApp
```

La respuesta del LLM debe contener `kw`, `@ction`, `body`, `text`, `query` y `params`. `body`, `text` y `query` conservan el mensaje real.

### HTTP activo de BBC hacia WMS

```text
Método: POST
URL: https://wms-seven-ebon.vercel.app/api/v1/webhook/builderbot
Body: from + info
Mapeo de respuesta: {mensaje}
```

No modificar el mapeo a texto literal ni sustituir `info` por un resumen.

### Tres credenciales distintas

| Variable/clave | Quién la usa | Para qué sirve |
| --- | --- | --- |
| `BUILDERBOT_MANAGER_API_KEY` | MCP/operador | Administrar proyectos, flujos y answers |
| `BUILDERBOT_API_TOKEN` | WMS | Enviar mensajes salientes por la API del bot |
| `BUILDERBOT_WEBHOOK_SECRET` | BBC y WMS | Autenticar llamadas entrantes al webhook WMS |

No son intercambiables.

### MCP Manager de BBC

Endpoint SSE:

```text
https://bbc-mcp-http.builderbot.cloud/mcp/builderbot/sse
```

Header:

```text
x-builderbot-api-key: <BUILDERBOT_MANAGER_API_KEY>
```

Secuencia técnica:

1. Abrir el stream SSE y leer el evento `endpoint`.
2. Enviar JSON-RPC `initialize` al endpoint de sesión.
3. Enviar `notifications/initialized`.
4. Ejecutar `tools/call`.

Herramientas útiles comprobadas:

```text
builderbot_list_projects
builderbot_list_flows
builderbot_list_answers
builderbot_update_answer
builderbot_create_answer
builderbot_validate_bot
builderbot_read_logs
```

Para leer estructura legacy cuando MCP no interpreta `rules`, usar:

```text
GET https://app.builderbot.cloud/api/v1/manager/flows/{projectId}
x-api-builderbot: <BUILDERBOT_MANAGER_API_KEY>
```

En Windows/Node, si aparece `unable to verify the first certificate`, ejecutar el cliente con `node --use-system-ca`. No usar `NODE_TLS_REJECT_UNAUTHORIZED=0` como solución permanente.

### Sincronización del prompt

1. Modificar y probar `docs/Prompt WMS.txt`.
2. Actualizar únicamente las answers de Entrada y Voz.
3. Releer los flujos por Manager API.
4. Comparar SHA-256 local y remoto.
5. Ejecutar `builderbot_validate_bot`.
6. Probar texto y audio por WhatsApp.

El SHA comprobado el 2026-08-04 es:

```text
f3888f9fbf065b789395d4b5233970b1efb15ad0334c4654c364d85fef501f90
```

El validador puede marcar falsamente Entrada como dead end por el formato legacy de la answer. Contrastar siempre con la lectura Manager antes de modificar la estructura.

### Mensajería saliente

Endpoint:

```text
POST https://app.builderbot.cloud/api/v2/{BUILDERBOT_BOT_ID}/messages
x-api-builderbot: <BUILDERBOT_API_TOKEN>
```

Body:

```json
{
  "number": "57XXXXXXXXXX",
  "messages": {
    "content": "Mensaje operativo"
  }
}
```

El servicio `api/_lib/builderbot-notifications.js` normaliza teléfonos colombianos, excluye usuarios bot, enmascara destinatarios en resultados y evita repetir el mismo evento por destinatario.

Variables necesarias:

```text
BUILDERBOT_BOT_ID
BUILDERBOT_API_TOKEN
DISABLE_OUTBOUND_NOTIFICATIONS
```

Las notificaciones salientes estan habilitadas por defecto. Definir
`DISABLE_OUTBOUND_NOTIFICATIONS=true` funciona como corte de emergencia y
detiene tanto envios nuevos como reintentos manuales.

## MySQL

### Conexión de la aplicación

Implementación: `api/_lib/db.js` con `mysql2/promise`.

Variables:

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
DB_SSL
```

Comportamiento:

- `query()` reutiliza una conexión si responde a `ping()`.
- `withTransaction()` y los servicios críticos usan una conexión dedicada.
- La conexión transaccional ejecuta `BEGIN`, `COMMIT`, `ROLLBACK` y cierre explícito.
- Vercel obtiene estas variables desde la configuración del proyecto.

No usar el pool o modelos Sequelize del backend Express para diagnosticar la API productiva; son una implementación histórica distinta.

### Verificación

Pública y no destructiva:

```text
GET https://wms-seven-ebon.vercel.app/api/v1/health
```

La respuesta debe mostrar:

- HTTP 200.
- `ok=true` y `db=connected`.
- tablas críticas presentes.

El endpoint actual también devuelve metadatos internos de tablas e identificadores recientes. Esto sirve para diagnóstico temporal, pero debe reducirse antes de producción con datos reales.

### MCP local de solo lectura

El workspace padre contiene un servidor local:

```text
C:\Users\juanr\Documents\WMS\mcp\mysql-readonly-server.mjs
```

Config Codex conceptual:

```toml
[mcp_servers.wms_mysql]
command = "node"
args = ["C:\\Users\\juanr\\Documents\\WMS\\mcp\\mysql-readonly-server.mjs"]
cwd = "C:\\Users\\juanr\\Documents\\WMS"
enabled = true
```

Variables locales:

```text
MYSQL_HOST
MYSQL_PORT
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
```

Herramientas:

```text
mysql_list_tables
mysql_describe_table
mysql_select
```

El servidor rechaza operaciones de escritura. Las migraciones y correcciones de datos deben ejecutarse por un canal administrado, con respaldo y aprobación explícita.

### Migraciones

Orden relevante:

```text
database/schema.sql
database/02_skus_and_views.sql
database/03_produccion_tables.sql
database/03_webhook_logs.sql
database/05_infinity_product_catalog.sql
database/07_workflow_roles.sql
database/08_warehouse_workflows.sql
database/09_notifications.sql
database/10_reception_reconciliation.sql
```

No ejecutar seeds de demo sobre producción. `database/06_test_fixtures_infinity_agent.sql` y los scripts `scripts/qa` crean datos de prueba identificables.

### TLS

Con `DB_SSL=true`, el código actual usa TLS con `rejectUnauthorized=false`. Antes de producción con datos reales se debe instalar la CA del proveedor y validar el certificado, en lugar de depender de esta excepción.

## Siigo

### Variables

```text
SIIGO_BASE_URL=https://api.siigo.com
SIIGO_USERNAME
SIIGO_ACCESS_KEY
SIIGO_PARTNER_ID
SIIGO_TEST_PREFIX
SIIGO_TIMEZONE_OFFSET
SIIGO_WMS_WAREHOUSE_CODE
WMS_PRIMARY_WAREHOUSE_CODE
WMS_PUBLIC_URL
```

Webhooks opcionales:

```text
SIIGO_WEBHOOK_SECRET
SIIGO_WEBHOOK_APPLICATION_ID
SIIGO_ALLOW_SHARED_SANDBOX_WEBHOOK_UPDATE
```

`WMS_PUBLIC_URL` es la base HTTPS pública del despliegue, sin ruta final. En el ambiente actual:

```text
https://wms-seven-ebon.vercel.app
```

Se usa para construir callbacks de webhooks; no es una credencial.

### Autenticación

```text
POST https://api.siigo.com/auth
Content-Type: application/json

{
  "username": "<SIIGO_USERNAME>",
  "access_key": "<SIIGO_ACCESS_KEY>"
}
```

El WMS guarda el token y vencimiento en `siigo_config`, renueva con cinco minutos de margen y reintenta una vez después de un 401.

Las lecturas con 429 tienen reintentos limitados. Las escrituras no se repiten automáticamente porque podrían duplicar documentos contables.

### Polling activo

Vercel ejecuta:

```text
*/2 * * * *   /api/v1/siigo/import-purchases
1-59/2 * * * * /api/v1/siigo/import-invoices
```

Los endpoints cron requieren `CRON_SECRET` cuando Vercel lo entrega. El polling es incremental e idempotente y usa prefijos/marcas temporales para evitar mezclar pruebas del sandbox compartido.

### Compras

```text
Factura de compra Siigo -> polling -> recepción pendiente WMS
-> vínculo con OC proveedor -> conteo/distribución física -> stock disponible
```

La recepción válida se confirma en el WMS. Las diferencias físicas no modifican automáticamente la factura contable.

### Ventas

```text
Factura de venta Siigo -> polling -> tarea/reserva WMS
-> confirmación física Anderson -> descuento de inventario y trazabilidad
```

Si falta stock, la tarea queda bloqueada o con backorder según las banderas. El WMS no anula ni corrige automáticamente la factura de Siigo.

### Webhooks

Existen handlers para productos, compras, facturas y notas crédito. En el sandbox compartido no cambiar suscripciones globales sin confirmar que no se afectan las pruebas de terceros. Mantener el polling como mecanismo confiable hasta disponer de una suscripción aislada.

### Diagnóstico

- `GET /api/v1/siigo/health`: requiere rol Admin o Supervisor y prueba autenticación/consulta.
- `GET /api/v1/siigo/retry-sync`: consultar errores pendientes.
- Tabla `siigo_sync_log`: trazabilidad de llamadas con datos sensibles redactados.
- No publicar payloads completos del sandbox en tickets o documentación.

## Vercel

### Proyecto desplegado

```text
URL: https://wms-seven-ebon.vercel.app
Runtime: funciones Node serverless + frontend Vite
Rama: main
```

`vercel.json` define instalación, build, salida SPA, rewrites y crons Siigo.

### Flujo de despliegue

```text
commit -> push a GitHub main -> integración Vercel -> build -> deployment
```

Después de cambiar variables de entorno se debe hacer redeploy. Verificar:

1. Build exitoso.
2. `GET /api/v1/health` en 200.
3. Login y `GET /api/v1/auth/me`.
4. Endpoint específico afectado.
5. Logs de funciones sin secretos.

### Variables sensibles mínimas

```text
DB_*
JWT_SECRET
JWT_REFRESH_SECRET
BUILDERBOT_WEBHOOK_SECRET
BUILDERBOT_API_TOKEN
BUILDERBOT_BOT_ID
SIIGO_USERNAME
SIIGO_ACCESS_KEY
SIIGO_PARTNER_ID
CRON_SECRET
```

No incluir `BUILDERBOT_MANAGER_API_KEY` en Vercel si la aplicación no administra BBC. Esa clave debe permanecer en el entorno del operador/MCP.

## GitHub

```text
Repositorio: https://github.com/royandi200/WMS
Remoto local: origin
Rama de despliegue: main
```

Antes de publicar:

```bash
git status --short
npm test
npm run build
git diff --check
```

No hacer commit de `.env`, volcados MySQL, tokens, credenciales Siigo, claves BBC ni teléfonos de prueba.

## JWT y acceso al dashboard

Variables:

```text
JWT_SECRET
JWT_EXPIRES_IN
JWT_REFRESH_SECRET
JWT_REFRESH_EXPIRES_IN
```

El access token protege las rutas y el refresh token renueva sesión. Las claves deben ser distintas, largas y aleatorias. Rotar credenciales temporales antes del uso productivo.

## Checklist de diagnóstico transversal

1. Confirmar el commit y deployment objetivo.
2. Consultar `/api/v1/health`.
3. Verificar variables por nombre, sin imprimir valores.
4. Identificar dirección: entrante, saliente o administración.
5. Confirmar que se usa la credencial correcta para esa dirección.
6. Revisar logs de Vercel, `webhook_logs`, `siigo_sync_log` o `notificaciones_salida`.
7. Repetir solo operaciones idempotentes.
8. Para mutaciones, comprobar estado previo y posterior en MySQL.
9. Enmascarar teléfonos y redactar tokens al compartir evidencia.

## Regla de mantenimiento

Actualizar este documento cuando cambie un endpoint, project ID, flow/answer ID, variable, proveedor, cron, mecanismo de autenticación o procedimiento de despliegue. Nunca registrar el valor real de un secreto.
