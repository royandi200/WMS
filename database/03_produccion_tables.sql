-- ============================================================
--  WMS — Tablas de Producción y Operaciones del Webhook
--  Ejecutar DESPUÉS de schema.sql y 02_skus_and_views.sql
--  Idempotente: usa CREATE TABLE IF NOT EXISTS
-- ============================================================
USE wms_db;

-- ══════════════════════════════════════════════════════════════
--  1. LOTS — Lotes de inventario con trazabilidad completa
--  Referenciada por: kardex, createLot(), lotIdByLpn()
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lots (
  id           VARCHAR(36)   NOT NULL PRIMARY KEY,           -- UUID
  lpn          VARCHAR(100)  NOT NULL UNIQUE,                -- Licence Plate Number (código lote)
  product_id   INT UNSIGNED  NOT NULL,
  bodega_id    INT UNSIGNED  NOT NULL,
  qty_initial  DECIMAL(15,4) NOT NULL DEFAULT 0,
  qty_current  DECIMAL(15,4) NOT NULL DEFAULT 0,
  supplier     VARCHAR(200)  NULL,
  origin       ENUM(
                 'RECEPCION','PRODUCCION','DEVOLUCION','AJUSTE','INICIAL'
               )              NOT NULL DEFAULT 'RECEPCION',
  status       ENUM(
                 'DISPONIBLE','CUARENTENA','DESPACHADO','AGOTADO','DESTRUCCION','RECUPERABLE'
               )              NOT NULL DEFAULT 'DISPONIBLE',
  received_by  INT UNSIGNED  NULL,
  notes        TEXT          NULL,
  expiry_date  DATE          NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_lots_product  FOREIGN KEY (product_id)  REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lots_bodega   FOREIGN KEY (bodega_id)   REFERENCES bodegas(id)   ON DELETE RESTRICT,
  CONSTRAINT fk_lots_user     FOREIGN KEY (received_by) REFERENCES usuarios(id)  ON DELETE SET NULL,

  INDEX idx_lots_lpn          (lpn),
  INDEX idx_lots_product      (product_id),
  INDEX idx_lots_bodega       (bodega_id),
  INDEX idx_lots_status       (status),
  INDEX idx_lots_expiry       (expiry_date)
);

-- ══════════════════════════════════════════════════════════════
--  2. KARDEX — Bitácora de movimientos con trazabilidad UUID
--  Referenciada por: logKardex(), CONSULTAR_TRAZABILIDAD_LOTE
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kardex (
  id            VARCHAR(36)   NOT NULL PRIMARY KEY,          -- UUID del registro
  tx_id         VARCHAR(36)   NOT NULL,                      -- UUID de la transacción agrupadora
  lot_id        VARCHAR(36)   NULL,                          -- FK a lots.id
  product_id    INT UNSIGNED  NOT NULL,
  user_id       INT UNSIGNED  NOT NULL,
  action        VARCHAR(50)   NOT NULL,                      -- INGRESO_RECEPCION, DESPACHO, AJUSTE_INVENTARIO…
  qty           DECIMAL(15,4) NOT NULL,                      -- positivo=entrada, negativo=salida
  balance_after DECIMAL(15,4) NULL,                          -- saldo después de la acción
  reference     VARCHAR(200)  NULL,                          -- ej. "recepcion:REC-2026-001"
  notes         TEXT          NULL,
  approved_by   INT UNSIGNED  NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_kardex_lot      FOREIGN KEY (lot_id)      REFERENCES lots(id)      ON DELETE SET NULL,
  CONSTRAINT fk_kardex_product  FOREIGN KEY (product_id)  REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_kardex_user     FOREIGN KEY (user_id)     REFERENCES usuarios(id)  ON DELETE RESTRICT,
  CONSTRAINT fk_kardex_approved FOREIGN KEY (approved_by) REFERENCES usuarios(id)  ON DELETE SET NULL,

  INDEX idx_kardex_lot        (lot_id),
  INDEX idx_kardex_product    (product_id),
  INDEX idx_kardex_action     (action),
  INDEX idx_kardex_created    (created_at),
  INDEX idx_kardex_tx         (tx_id)
);

-- ══════════════════════════════════════════════════════════════
--  3. SYSTEM_LOGS — Log de eventos internos del webhook
--  Referenciada por: logSystemEvent()
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS system_logs (
  id         INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  nivel      ENUM('INFO','WARN','ERROR','DEBUG') NOT NULL DEFAULT 'INFO',
  modulo     VARCHAR(50)   NOT NULL DEFAULT 'webhook',
  mensaje    TEXT          NOT NULL,
  usuario_id INT UNSIGNED  NULL,
  payload    JSON          NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_syslogs_user FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,

  INDEX idx_syslogs_nivel    (nivel),
  INDEX idx_syslogs_modulo   (modulo),
  INDEX idx_syslogs_created  (created_at)
);

-- ══════════════════════════════════════════════════════════════
--  4. BOM — Bill of Materials (receta de producción)
--  Referenciada por: SOLICITAR_INICIO_PRODUCCION,
--                    CONSULTAR_CAPACIDAD_FABRICACION,
--                    CONFIRMAR_MATERIALES_PRODUCCION
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bom (
  id                 INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  producto_final_id  INT UNSIGNED  NOT NULL,                 -- producto terminado que se fabrica
  insumo_id          INT UNSIGNED  NOT NULL,                 -- materia prima / insumo
  cantidad_por_unidad DECIMAL(15,6) NOT NULL,                -- cantidad de insumo por 1 unidad de PT
  unidad             VARCHAR(20)   NOT NULL DEFAULT 'und',
  notas              TEXT          NULL,
  activo             TINYINT(1)    NOT NULL DEFAULT 1,
  creado_en          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_bom_final  FOREIGN KEY (producto_final_id) REFERENCES productos(id) ON DELETE CASCADE,
  CONSTRAINT fk_bom_insumo FOREIGN KEY (insumo_id)         REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT uq_bom_par    UNIQUE (producto_final_id, insumo_id),

  INDEX idx_bom_final  (producto_final_id),
  INDEX idx_bom_insumo (insumo_id)
);

-- ══════════════════════════════════════════════════════════════
--  5. ORDENES_PRODUCCION — Órdenes de fabricación
--  Referenciada por: AVANCE_FASES, SOLICITAR_INICIO_PRODUCCION,
--                    SOLICITAR_CIERRE_PRODUCCION,
--                    CONFIRMAR_MATERIALES_PRODUCCION,
--                    CONSULTAR_ESTADO_PRODUCCION
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ordenes_produccion (
  id                  INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  codigo_orden        VARCHAR(30)   NOT NULL UNIQUE,          -- OP-YYYYMMDD-0001
  producto_id         INT UNSIGNED  NOT NULL,
  cantidad_planeada   DECIMAL(15,4) NOT NULL,
  cantidad_real       DECIMAL(15,4) NULL,
  estado              ENUM(
                        'PLANEADA','APROBADA','EN_PROCESO','CERRADA','CANCELADA'
                      )             NOT NULL DEFAULT 'PLANEADA',
  fase                VARCHAR(20)   NULL DEFAULT 'F0',        -- AVANCE_FASES actualiza esta columna
  notas               TEXT          NULL,
  creado_por          INT UNSIGNED  NULL,
  aprobado_por        INT UNSIGNED  NULL,
  materiales_conf_en  DATETIME      NULL,
  cerrado_en          DATETIME      NULL,
  creado_en           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_op_producto    FOREIGN KEY (producto_id)  REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_op_creado_por  FOREIGN KEY (creado_por)   REFERENCES usuarios(id)  ON DELETE SET NULL,
  CONSTRAINT fk_op_aprobado    FOREIGN KEY (aprobado_por) REFERENCES usuarios(id)  ON DELETE SET NULL,

  INDEX idx_op_estado       (estado),
  INDEX idx_op_codigo       (codigo_orden),
  INDEX idx_op_producto     (producto_id),
  INDEX idx_op_creado_en    (creado_en)
);

-- ══════════════════════════════════════════════════════════════
--  6. APROBACIONES — Cola de aprobaciones para operaciones
--  Referenciada por: APROBAR_SOLICITUD, RECHAZAR_SOLICITUD,
--                    CONSULTAR_SOLICITUDES_PENDIENTES,
--                    nextSolicitudCodigo()
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS aprobaciones (
  id                INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  codigo_solicitud  VARCHAR(20)   NOT NULL UNIQUE,            -- REQ-000001
  accion            VARCHAR(60)   NOT NULL,                   -- SOLICITAR_INICIO_PRODUCCION, etc.
  payload           JSON          NOT NULL,                   -- datos para executeApprovedPayload()
  solicitado_por    INT UNSIGNED  NULL,
  procesado_por     INT UNSIGNED  NULL,
  estado            ENUM(
                      'PENDIENTE','APROBADO','RECHAZADO'
                    )             NOT NULL DEFAULT 'PENDIENTE',
  motivo_rechazo    TEXT          NULL,
  creado_en         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  procesado_en      DATETIME      NULL,

  CONSTRAINT fk_apro_solicitado  FOREIGN KEY (solicitado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_apro_procesado   FOREIGN KEY (procesado_por)  REFERENCES usuarios(id) ON DELETE SET NULL,

  INDEX idx_apro_estado    (estado),
  INDEX idx_apro_codigo    (codigo_solicitud),
  INDEX idx_apro_creado_en (creado_en)
);

-- ══════════════════════════════════════════════════════════════
--  7. SEED BOM — Recetas demo para los 4 productos terminados
--  (idempotente gracias al UNIQUE en bom(producto_final_id, insumo_id))
-- ══════════════════════════════════════════════════════════════

-- PT-VITC-30 (id=13): 30 gomitas Vitamina C x30 uds
INSERT IGNORE INTO bom (producto_final_id, insumo_id, cantidad_por_unidad, unidad, notas) VALUES
(13, 1, 0.002500, 'kg', 'Gelatina 2.5g/ud'),        -- RM-GEL-25K
(13, 2, 0.003000, 'kg', 'Azúcar 3g/ud'),             -- RM-AZU-25K
(13, 3, 0.000200, 'kg', 'Ácido cítrico 0.2g/ud'),    -- RM-CIT-5K
(13, 4, 0.002000, 'kg', 'Vitamina C 2g/ud'),          -- RM-VITC-1K
(13, 7, 1.000000, 'und','Botella 500ml 1 ud/bolsa'),  -- EM-BOT-500
(13,10, 0.020000, 'hoj','Etiqueta 0.02 hoja/ud');     -- EM-ETI-A4

-- PT-CREA-10 (id=14): Gomitas Creatina x10 uds
INSERT IGNORE INTO bom (producto_final_id, insumo_id, cantidad_por_unidad, unidad, notas) VALUES
(14, 1, 0.002000, 'kg', 'Gelatina 2g/ud'),
(14, 2, 0.002500, 'kg', 'Azúcar 2.5g/ud'),
(14, 3, 0.000150, 'kg', 'Ácido cítrico 0.15g/ud'),
(14, 5, 0.005000, 'kg', 'Creatina 5g/ud'),           -- RM-CREA-1K
(14, 7, 1.000000, 'und','Botella 500ml'),
(14,10, 0.020000, 'hoj','Etiqueta');

-- PT-COLA-20 (id=15): Gomitas Colágeno x20 uds
INSERT IGNORE INTO bom (producto_final_id, insumo_id, cantidad_por_unidad, unidad, notas) VALUES
(15, 1, 0.002000, 'kg', 'Gelatina 2g/ud'),
(15, 2, 0.003000, 'kg', 'Azúcar 3g/ud'),
(15, 3, 0.000200, 'kg', 'Ácido cítrico'),
(15, 6, 0.003000, 'kg', 'Colágeno 3g/ud'),            -- RM-COLA-1K
(15, 9, 1.000000, 'und','Doypack 500g'),               -- EM-DOYP-LG
(15,10, 0.020000, 'hoj','Etiqueta');

-- PT-MIXB-60 (id=16): Mix Bienestar x60 uds
INSERT IGNORE INTO bom (producto_final_id, insumo_id, cantidad_por_unidad, unidad, notas) VALUES
(16, 1, 0.002500, 'kg', 'Gelatina 2.5g/ud'),
(16, 2, 0.003000, 'kg', 'Azúcar 3g/ud'),
(16, 3, 0.000200, 'kg', 'Ácido cítrico'),
(16, 4, 0.001000, 'kg', 'Vitamina C 1g/ud'),
(16, 5, 0.002500, 'kg', 'Creatina 2.5g/ud'),
(16, 6, 0.001500, 'kg', 'Colágeno 1.5g/ud'),
(16, 9, 1.000000, 'und','Doypack 500g'),
(16,10, 0.020000, 'hoj','Etiqueta');

-- ══════════════════════════════════════════════════════════════
--  8. VIEW auxiliar v_stock_disponible — extendida para webhook
--  Agrega columnas tipo_producto y disponible que usa queryStockDisponible()
--  Se reemplaza la existente (CREATE OR REPLACE es seguro)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_stock_disponible AS
SELECT
  s.id                                AS stock_id,
  p.id                                AS producto_id,
  sk.sku,
  p.nombre,
  p.referencia,
  p.barcode,
  p.marca,
  CASE
    WHEN p.nombre LIKE '%Gelatina%'
      OR p.nombre LIKE '%Azúcar%'
      OR p.nombre LIKE '%Ácido%'
      OR p.nombre LIKE '%Vitamina%'
      OR p.nombre LIKE '%Creatina%'
      OR p.nombre LIKE '%Colágeno%'
      OR p.siigo_code LIKE 'RM-%'
    THEN 'MP'
    WHEN p.siigo_code LIKE 'PT-%'
    THEN 'PT'
    ELSE 'OT'
  END                                 AS tipo_producto,
  b.codigo                            AS bodega,
  b.nombre                            AS bodega_nombre,
  u.codigo                            AS ubicacion,
  u.zona,
  s.lote,
  s.fecha_venc                        AS vence,
  s.cantidad                          AS qty_total,
  s.reservada                         AS qty_reservada,
  (s.cantidad - s.reservada)          AS disponible,
  CASE
    WHEN s.fecha_venc IS NULL              THEN 'sin_vencimiento'
    WHEN s.fecha_venc < CURDATE()          THEN 'vencido'
    WHEN s.fecha_venc < DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'por_vencer'
    ELSE                                        'vigente'
  END                                 AS estado_lote,
  s.actualizado_en
FROM stock s
JOIN productos    p  ON p.id  = s.producto_id
JOIN bodegas      b  ON b.id  = s.bodega_id
LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
LEFT JOIN skus    sk ON sk.producto_id = s.producto_id AND sk.tipo = 'PRINCIPAL'
WHERE s.cantidad > 0
  AND p.activo  = 1
  AND b.activa  = 1;

-- ══════════════════════════════════════════════════════════════
--  9. Columna telefono en usuarios (usada por getSupervisorPhone)
--  ALTER es seguro con IF NOT EXISTS en MySQL 8+
-- ══════════════════════════════════════════════════════════════
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS telefono VARCHAR(20) NULL COMMENT 'Número WhatsApp sin + ni espacios';

UPDATE usuarios SET telefono = '573001234567' WHERE id = 3 AND telefono IS NULL;  -- Laura (Supervisor)
UPDATE usuarios SET telefono = '573001234568' WHERE id = 1 AND telefono IS NULL;  -- Admin

-- ══════════════════════════════════════════════════════════════
--  VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════
SELECT tabla, registros FROM (
  SELECT 'lots'               AS tabla, COUNT(*) AS registros FROM lots
  UNION ALL SELECT 'kardex',              COUNT(*) FROM kardex
  UNION ALL SELECT 'system_logs',         COUNT(*) FROM system_logs
  UNION ALL SELECT 'bom',                 COUNT(*) FROM bom
  UNION ALL SELECT 'ordenes_produccion',  COUNT(*) FROM ordenes_produccion
  UNION ALL SELECT 'aprobaciones',        COUNT(*) FROM aprobaciones
) AS resumen;
