# Seeds de Prueba WMS

## Cómo ejecutar

### Opción A — phpMyAdmin
1. Abrir phpMyAdmin
2. Seleccionar la base de datos WMS
3. Pestaña **SQL**
4. Pegar el contenido de `seed_demo.sql` y ejecutar

### Opción B — MySQL CLI
```bash
mysql -u root -p wms_db < backend/seeds/seed_demo.sql
```

### Opción C — Desde el servidor backend
```bash
cd backend
mysql -u $DB_USER -p$DB_PASS $DB_NAME < seeds/seed_demo.sql
```

---

## Credenciales de prueba

| Usuario | Email | Contraseña | Rol |
|---|---|---|---|
| Admin WMS | admin@wms.co | Test1234! | admin |
| Carlos Bodega | carlos@wms.co | Test1234! | operario |
| Laura Sup | laura@wms.co | Test1234! | supervisor |

---

## Qué incluye el seed

| Tabla | Registros | Descripción |
|---|---|---|
| roles | 3 | admin, operario, supervisor |
| users | 4 | 3 humanos + 1 bot BuilderBot |
| products | 6 | Mix de tipos: MP, PT, Insumo, Empaque |
| lots | 8 | DISPONIBLE x6, CUARENTENA x1, AGOTADO x1 |
| production_orders | 3 | PENDING, IN\_PROGRESS (F3), CLOSED |
| kardex | 16 | Ingresos, consumos, despachos, mermas |
| waste\_records | 4 | 4 tipos distintos de merma |
| approval\_queue | 5 | Todos PENDIENTE — listos para aprobar/rechazar |
| webhook\_logs | 6 | Mensajes BuilderBot simulados |

---

## Escenarios de prueba sugeridos

### 1. Inventario
- Buscar lote `L-2026-001` → debe mostrar 1850 tapas
- Buscar lote `L-2025-099` → estado CUARENTENA
- Buscar producto por SKU `RM-BOT-500` → stock bajo el mínimo
- Ver Kardex filtrado por `RM-TAP-MED` → debe mostrar ingresos y mermas

### 2. Aprobaciones
- Entrar a `/aprobaciones` → 5 solicitudes pendientes
- Aprobar `REQ-2026-003` (despacho)
- Rechazar `REQ-2026-002` (merma) con motivo

### 3. Producción
- Ver orden `dddddddd-0000-0000-0000-000000000001` en fase F3
- Avanzar a F4 usando el ID
- Cerrar con `qty_real: 4850`

### 4. Webhook Logs
- Entrar a `/webhook-logs`
- Filtrar por status `REJECTED` → debe aparecer el log de RM-FIL-CAR
- Filtrar por prioridad `alta` → debe mostrar inicio producción y merma
- Expandir cualquier log → ver payload y respuesta JSON

### 5. Dashboard
- KPI "Bajo mínimo" debe mostrar al menos 1 alerta (botellas RM-BOT-500)
- KPI "Aprobaciones pend." debe mostrar 5
- Tarjetas son clickeables y llevan a la página correcta
