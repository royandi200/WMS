# Plan de Pruebas — Integración SIIGO API
> Guía operativa paso a paso para validar la integración del WMS con SIIGO API sandbox.
> Ejecutar en orden. Cada prueba depende de la anterior.

---

## Preparación previa

Antes de empezar, asegúrate de tener estas variables en tu archivo `.env`:

```env
SIIGO_BASE_URL=https://api.siigo.com
SIIGO_USERNAME=sandbox@siigoapi.com
SIIGO_ACCESS_KEY=YmEzYTcyOGYtN2JhZi00OTIzLWE5ZjktYTgxNTVhNWUxZDM2Ojc0ODllKUZrSFM=
SIIGO_PARTNER_ID=wms-integration
```

Ten abiertos en el navegador:
- **Siigo Nube sandbox:** https://siigonube.siigo.com → usuario `sandbox@siigoapi.com` / contraseña `111111`
- **Tu WMS local o de pruebas** corriendo en `http://localhost:3000` (o la URL que uses)
- **Postman o Thunder Client** para enviar las peticiones

En todas las peticiones al WMS agrega el header:
```
Authorization: Bearer <tu-token-de-admin-del-WMS>
```

---

## PT-01 — Verificar conexión con SIIGO (health check)

**Objetivo:** Confirmar que el WMS puede autenticarse contra SIIGO y el token queda cacheado en la base de datos.

**Pasos:**

1. Abre Postman (o Thunder Client).
2. Crea una petición `GET` a:
   ```
   http://localhost:3000/api/v1/siigo/health
   ```
3. Agrega el header `Authorization: Bearer <tu-token-admin>`.
4. Haz clic en **Send**.

**Qué esperar:**
```json
{
  "ok": true,
  "data": {
    "mensaje": "Conexión con SIIGO exitosa ✅",
    "token_presente": true,
    "document_types_count": 15,
    "latencia_ms": 320
  }
}
```
- `ok` debe ser `true`.
- `token_presente` debe ser `true`.
- `document_types_count` debe ser mayor a 0 (SIIGO sandbox tiene varios tipos).

**Verificar en base de datos:**
```sql
SELECT clave, valor FROM siigo_config WHERE clave IN ('access_token','token_expiry');
```
- `access_token` debe tener un JWT largo (empieza con `eyJ...`).
- `token_expiry` debe ser una fecha futura (aprox. 24 horas desde ahora).

**Verificar en log:**
```sql
SELECT endpoint, status_code, duracion_ms, creado_en
FROM siigo_sync_log
ORDEN BY id DESC LIMIT 5;
```
- Debe aparecer una fila con `endpoint = '/auth'` y `status_code = 200`.

---

## PT-02 — Confirmar que el token se reutiliza (no hace login doble)

**Objetivo:** Verificar que el sistema usa el token cacheado y no llama a `/auth` en cada petición.

**Pasos:**

1. Anota cuántas filas hay en `siigo_sync_log` con `endpoint = '/auth'`:
   ```sql
   SELECT COUNT(*) FROM siigo_sync_log WHERE endpoint = '/auth';
   ```
   Guarda ese número (ej. `1`).
2. Vuelve a llamar `GET /api/v1/siigo/health` desde Postman.
3. Vuelve a contar:
   ```sql
   SELECT COUNT(*) FROM siigo_sync_log WHERE endpoint = '/auth';
   ```

**Qué esperar:**
- El conteo **no debe aumentar**. Debe seguir siendo `1` (reutilizó el token cacheado).

---

## PT-03 — Forzar refresco automático de token

**Objetivo:** Confirmar que si el token está a punto de expirar, el sistema hace re-login solo.

**Pasos:**

1. Simula token vencido actualizando la fecha de expiración en la base de datos:
   ```sql
   UPDATE siigo_config
   SET valor = '2020-01-01T00:00:00.000Z'
   WHERE clave = 'token_expiry';
   ```
2. Llama de nuevo a `GET /api/v1/siigo/health`.
3. Verifica en la base de datos:
   ```sql
   SELECT valor FROM siigo_config WHERE clave = 'token_expiry';
   ```

**Qué esperar:**
- La fecha de `token_expiry` debe ser nueva (fecha futura de hoy).
- En `siigo_sync_log` debe aparecer un nuevo registro con `endpoint = '/auth'`.
- La respuesta del endpoint sigue siendo `ok: true`.

---

## PT-04 — Sincronizar tipos de comprobante

**Objetivo:** Traer de SIIGO los IDs de los tipos de documento (FV, FC, AJ) que se usarán para crear facturas.

**Pasos:**

1. En Postman, crea una petición `POST` a:
   ```
   http://localhost:3000/api/v1/siigo/sync-document-types
   ```
2. Header: `Authorization: Bearer <tu-token-admin>`.
3. Body: vacío (no requiere body).
4. Haz clic en **Send**.

**Qué esperar:**
```json
{
  "ok": true,
  "data": {
    "total_synced": 12,
    "doc_id_factura_vta": 29,
    "doc_id_factura_cmp": 30,
    "doc_id_ajuste": 45,
    "tipos": [...]
  }
}
```
- `doc_id_factura_vta` y `doc_id_factura_cmp` **no deben ser null**. Si son null, las fases de facturas van a fallar.

**Verificar en base de datos:**
```sql
SELECT clave, valor FROM siigo_config
WHERE clave IN ('doc_id_factura_vta','doc_id_factura_cmp','doc_id_ajuste');

SELECT siigo_id, codigo, nombre, tipo FROM siigo_documentos LIMIT 20;
```
- La tabla `siigo_documentos` debe tener registros con tipos `FV`, `FC`, `AJ`, `NC`.

---

## PT-05 — Sincronizar catálogo de productos

**Objetivo:** Importar todos los productos del sandbox de SIIGO a la tabla local `productos`.

**Pasos:**

1. Anota cuántos productos hay antes:
   ```sql
   SELECT COUNT(*) FROM productos WHERE siigo_id IS NOT NULL;
   ```
2. En Postman, `POST` a:
   ```
   http://localhost:3000/api/v1/siigo/sync-products
   ```
3. Header: `Authorization: Bearer <tu-token-admin>`. Body: vacío.
4. Envía la petición. **Puede tardar varios segundos** si hay muchos productos.

**Qué esperar:**
```json
{
  "ok": true,
  "data": {
    "total_siigo": 25,
    "creados": 25,
    "actualizados": 0,
    "errores": 0,
    "duracion_ms": 1800
  }
}
```
- `errores` debe ser `0`.
- `creados` debe coincidir con los productos que ves en Siigo Nube → Inventario → Productos.

**Verificar idempotencia** (que no duplique):
1. Envía la misma petición una segunda vez.
2. Ahora `creados` debe ser `0` y `actualizados` debe ser igual al total.

**Verificar en base de datos:**
```sql
SELECT siigo_code, siigo_id, nombre, precio_venta, siigo_synced_at
FROM productos
WHERE siigo_id IS NOT NULL
LIMIT 10;
```

---

## PT-06 — Sincronizar clientes y proveedores (terceros)

**Objetivo:** Importar todos los terceros del sandbox a la tabla `terceros`.

**Pasos:**

1. En Postman, `POST` a:
   ```
   http://localhost:3000/api/v1/siigo/sync-terceros
   ```
2. Header: `Authorization: Bearer <tu-token-admin>`. Body: vacío.
3. Envía la petición.

**Qué esperar:**
```json
{
  "ok": true,
  "data": {
    "total_siigo": 10,
    "creados": 10,
    "actualizados": 0,
    "errores": 0
  }
}
```

**Verificar en base de datos:**
```sql
SELECT identification, nombre, tipo, siigo_id, siigo_synced_at
FROM terceros
WHERE siigo_id IS NOT NULL
LIMIT 10;
```
- Cada fila debe tener `siigo_id` (UUID de SIIGO) e `identification` (NIT o cédula).

---

## PT-07 — Crear una Factura de Compra en SIIGO desde una recepción

**Objetivo:** Completar una recepción en el WMS y verificar que crea la FC en SIIGO automáticamente.

**Pasos:**

1. Entra al WMS en el navegador e ingresa al módulo de **Recepciones**.
2. Crea una recepción nueva:
   - Selecciona un proveedor (debe ser un tercero sincronizado en PT-06).
   - Agrega al menos 1 ítem con un producto sincronizado en PT-05.
   - Ingresa precio unitario (ej. `50000`).
   - Guarda la recepción.
3. Cambia el estado de la recepción a **Completada** (esto dispara `pushCompraToSiigo`).
4. Espera la respuesta del sistema.

**Qué esperar:**
- El sistema muestra `siigo_purchase_name` con un código tipo `FC-001-000012`.

**Verificar en base de datos:**
```sql
SELECT numero, estado, siigo_purchase_id, siigo_purchase_name, siigo_synced_at
FROM recepciones
ORDER BY id DESC LIMIT 1;
```
- `siigo_purchase_id` no debe ser null.
- `siigo_synced_at` debe tener la fecha de hoy.

**Verificar en Siigo Nube:**
1. Ve a https://siigonube.siigo.com → **Compras** → **Facturas de Compra**.
2. Busca la factura con el nombre `FC-XXX-XXX` que aparece en el WMS.
3. Debe existir con los mismos ítems y montos.

---

## PT-08 — Crear una Factura de Venta en SIIGO desde un despacho

**Objetivo:** Confirmar un despacho en el WMS y verificar que crea la FV en SIIGO con CUFE de la DIAN.

**Pasos:**

1. Entra al módulo de **Despachos** en el WMS.
2. Crea un despacho nuevo:
   - Selecciona un cliente (tercero sincronizado en PT-06).
   - Agrega al menos 1 ítem con producto y precio (ej. `120000`).
   - Guarda el despacho.
3. Cambia el estado del despacho a **Despachado** (esto dispara `pushFacturaToSiigo`).
4. Espera la respuesta del sistema.

**Qué esperar:**
- El sistema muestra `siigo_invoice_name` tipo `FV-001-000034` y un CUFE largo.

**Verificar en base de datos:**
```sql
SELECT numero, estado, siigo_invoice_id, siigo_invoice_name,
       cufe, stamp_status, siigo_synced_at
FROM despachos
ORDER BY id DESC LIMIT 1;
```
- `siigo_invoice_id` no debe ser null.
- `cufe` debe tener un hash largo (confirma que fue a la DIAN).
- `stamp_status` debe ser `Accepted` o `Draft` (en sandbox puede ser Draft).

**Verificar en Siigo Nube:**
1. Ve a https://siigonube.siigo.com → **Ventas** → **Facturas de Venta**.
2. Busca la factura `FV-XXX-XXX`.
3. Debe existir con los ítems, cliente y monto correctos.

---

## PT-09 — Simular fallo y verificar reintento automático

**Objetivo:** Confirmar que si SIIGO falla, el movimiento queda pendiente y el retry lo resuelve.

**Pasos:**

1. Temporalmente rompe las credenciales en `.env`:
   ```env
   SIIGO_ACCESS_KEY=CLAVE_INCORRECTA
   ```
   Reinicia el servidor WMS.
2. Crea un nuevo despacho y cámbialo a **Despachado**.
3. El sistema debe mostrar un error (no pudo conectar con SIIGO).
4. Verifica en base de datos que quedó marcado para reintento:
   ```sql
   SELECT id, tipo, referencia_tipo, referencia_id, siigo_sync
   FROM movimientos
   WHERE siigo_sync = 0
   ORDER BY id DESC LIMIT 5;
   ```
   - Debe aparecer el movimiento con `siigo_sync = 0`.
5. Restaura la clave correcta en `.env` y reinicia el servidor.
6. Ahora llama el endpoint de reintentos en Postman, `POST` a:
   ```
   http://localhost:3000/api/v1/siigo/retry-sync
   ```
7. Envía la petición.

**Qué esperar:**
```json
{
  "ok": true,
  "data": {
    "pendientes": 1,
    "procesados": 1,
    "errores": 0
  }
}
```
- Vuelve a consultar `movimientos`: el registro debe tener `siigo_sync = 1` ahora.

---

## PT-10 — Probar webhooks en tiempo real (requiere URL pública)

**Objetivo:** Verificar que SIIGO puede notificar al WMS cuando ocurren eventos.

**Preparación:**

Si estás en local, usa [ngrok](https://ngrok.com) para exponer el WMS:
```bash
ngrok http 3000
```
Copia la URL pública que ngrok genera (ej. `https://abc123.ngrok.io`) y agrégala al `.env`:
```env
WMS_PUBLIC_URL=https://abc123.ngrok.io
```
Reinicia el servidor.

**Paso 1 — Suscribir los webhooks:**
1. En Postman, `POST` a:
   ```
   http://localhost:3000/api/v1/siigo/webhooks-subscribe
   ```
2. Header: `Authorization: Bearer <tu-token-admin>`. Body: vacío.
3. Envía.

**Qué esperar:**
```json
{
  "ok": true,
  "data": {
    "exitosos": 6,
    "total": 6,
    "resultados": [
      { "label": "products.create", "ok": true, "siigo_id": "abc-123" },
      ...
    ]
  }
}
```
- `exitosos` debe ser `6`. Si alguno falla, revisa que `WMS_PUBLIC_URL` sea accesible desde internet.

**Paso 2 — Probar webhook de producto:**
1. Ve a Siigo Nube → **Inventario** → **Productos** → **Nuevo Producto**.
2. Crea un producto de prueba y guárdalo.
3. Espera 5–10 segundos.
4. Verifica en base de datos del WMS:
   ```sql
   SELECT siigo_code, nombre, siigo_synced_at
   FROM productos
   ORDER BY siigo_synced_at DESC LIMIT 3;
   ```
   - El producto nuevo debe aparecer con `siigo_synced_at` reciente.

**Paso 3 — Probar webhook de factura de venta:**
1. Ve a Siigo Nube → **Ventas** → **Nueva Factura de Venta**.
2. Crea una factura con un cliente y al menos 1 producto. Guárdala.
3. Espera 5–10 segundos.
4. Verifica en el WMS:
   ```sql
   SELECT numero, estado, siigo_invoice_id, siigo_invoice_name, creado_en
   FROM despachos
   ORDER BY id DESC LIMIT 3;
   ```
   - Debe aparecer un nuevo despacho en estado `borrador` con el `siigo_invoice_name` de la FV creada.

**Paso 4 — Probar webhook de anulación:**
1. En Siigo Nube, anula la factura de venta que acabas de crear.
2. Espera 5–10 segundos.
3. Verifica en el WMS:
   ```sql
   SELECT numero, estado FROM despachos ORDER BY id DESC LIMIT 3;
   ```
   - El despacho correspondiente debe estar en estado `anulado`.

---

## Checklist final antes de pasar a producción

Marca cada punto antes de solicitar credenciales de producción a SIIGO:

- [ ] PT-01 a PT-03: autenticación y token cache funcionando
- [ ] PT-04: IDs de comprobantes FV y FC guardados en `siigo_config`
- [ ] PT-05 a PT-06: catálogo de productos y terceros importado sin errores
- [ ] PT-07: FC creada en SIIGO y visible en Siigo Nube → Compras
- [ ] PT-08: FV creada en SIIGO con CUFE, visible en Siigo Nube → Ventas
- [ ] PT-09: fallo simulado y reintento exitoso con `retry-sync`
- [ ] PT-10: webhooks suscritos y eventos recibidos en tiempo real
- [ ] `siigo_sync_log` sin registros con `status_code` 5xx
- [ ] Tabla `movimientos` sin registros con `siigo_sync = 0` pendientes

**Cuando todo esté en verde**, solicita las credenciales de producción en:
https://siigonube.portaldeclientes.siigo.com/generar-credenciales-api/

Actualiza el `.env` de producción y corre de nuevo:
1. `POST /api/v1/siigo/health` — verificar conexión prod
2. `POST /api/v1/siigo/sync-document-types` — IDs de comprobantes prod
3. `POST /api/v1/siigo/sync-products` — catálogo prod
4. `POST /api/v1/siigo/sync-terceros` — terceros prod
5. `POST /api/v1/siigo/webhooks-subscribe` — activar webhooks prod

---

**Soporte SIIGO API:** soporteapi@siigo.com
**Documentación:** https://developers.siigolatam.com/docs/siigoapi/
**Colección Postman oficial:** https://saprodcentralassets.blob.core.windows.net/siigoapi/documentation/SiigoAPI_Pruebas.postman_collection
