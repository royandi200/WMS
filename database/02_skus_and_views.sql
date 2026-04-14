-- ============================================================
--  WMS — Tabla de SKUs + VIEWs operacionales
--  Aplica sobre wms_db (ejecutar DESPUÉS de schema.sql)
-- ============================================================
USE wms_db;

-- ══════════════════════════════════════════════════════════════
--  TABLA: skus
--  Un producto puede tener varios SKUs (distintas presentaciones,
--  empaques, referencias de cliente o de proveedor).
--  El SKU "principal" es el que va a SIIGO (siigo_code en productos).
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS skus (
  id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  producto_id     INT UNSIGNED  NOT NULL,
  sku             VARCHAR(80)   NOT NULL,                       -- código único del SKU
  tipo            ENUM(
                    'PRINCIPAL',    -- código SIIGO principal
                    'ALTERNO',      -- referencia alterna interna
                    'PROVEEDOR',    -- referencia que usa el proveedor
                    'CLIENTE',      -- referencia que usa el cliente
                    'BARCODE',      -- código de barras EAN/UPC
                    'QR',           -- código QR
                    'INTERNO'       -- código interno de bodega
                  ) NOT NULL DEFAULT 'ALTERNO',
  descripcion     VARCHAR(200)  NULL,                           -- descripción libre del alias
  unidad          VARCHAR(20)   NOT NULL DEFAULT 'und',         -- unidad de medida del SKU
  factor_conv     DECIMAL(15,6) NOT NULL DEFAULT 1,             -- factor vs unidad base del producto
  activo          TINYINT(1)    NOT NULL DEFAULT 1,
  proveedor_id    INT UNSIGNED  NULL,                           -- FK a terceros si es referencia proveedor
  cliente_id      INT UNSIGNED  NULL,                           -- FK a terceros si es referencia cliente
  notas           TEXT          NULL,
  creado_en       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_skus_producto   FOREIGN KEY (producto_id)  REFERENCES productos(id)  ON DELETE RESTRICT,
  CONSTRAINT fk_skus_proveedor  FOREIGN KEY (proveedor_id) REFERENCES terceros(id)   ON DELETE SET NULL,
  CONSTRAINT fk_skus_cliente    FOREIGN KEY (cliente_id)   REFERENCES terceros(id)   ON DELETE SET NULL,

  CONSTRAINT uq_sku             UNIQUE (sku),                   -- un SKU es único en toda la base
  INDEX idx_skus_producto       (producto_id),
  INDEX idx_skus_tipo           (tipo),
  INDEX idx_skus_activo         (activo)
);

-- Poblar SKU PRINCIPAL desde los productos ya existentes
-- (idempotente, se puede re-ejecutar)
INSERT IGNORE INTO skus (producto_id, sku, tipo, descripcion)
SELECT id, siigo_code, 'PRINCIPAL', CONCAT('SKU principal - ', nombre)
FROM   productos
WHERE  siigo_code IS NOT NULL;

-- ══════════════════════════════════════════════════════════════
--  VIEW 1: v_stock_disponible
--  Stock neto por producto x bodega x ubicación,
--  con SKU principal, nombre, unidad y cantidades.
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_stock_disponible AS
SELECT
  s.id                              AS stock_id,
  p.id                              AS producto_id,
  sk.sku                            AS sku,
  p.nombre                          AS producto,
  p.referencia,
  p.barcode,
  p.marca,
  b.codigo                          AS bodega_codigo,
  b.nombre                          AS bodega,
  u.codigo                          AS ubicacion,
  u.zona,
  s.lote,
  s.serial,
  s.fecha_venc,
  s.cantidad                        AS qty_total,
  s.reservada                       AS qty_reservada,
  (s.cantidad - s.reservada)        AS qty_disponible,
  CASE
    WHEN s.fecha_venc IS NULL           THEN 'sin_vencimiento'
    WHEN s.fecha_venc < CURDATE()       THEN 'vencido'
    WHEN s.fecha_venc < DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'por_vencer'
    ELSE                                     'vigente'
  END                               AS estado_vencimiento,
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
--  VIEW 2: v_kardex
--  Bitácora completa de movimientos con datos legibles
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_kardex AS
SELECT
  m.id                              AS movimiento_id,
  m.tipo,
  p.id                              AS producto_id,
  sk.sku,
  p.nombre                          AS producto,
  bo.codigo                         AS bodega_origen,
  bd.codigo                         AS bodega_destino,
  m.lote,
  m.cantidad,
  m.referencia_tipo,
  m.referencia_id,
  COALESCE(r.numero, d.numero)      AS documento_numero,
  u.nombre                          AS usuario,
  m.siigo_sync,
  m.siigo_voucher_id,
  m.creado_en                       AS fecha
FROM movimientos m
JOIN productos   p   ON p.id   = m.producto_id
JOIN usuarios    u   ON u.id   = m.usuario_id
LEFT JOIN bodegas       bo  ON bo.id  = m.bodega_orig
LEFT JOIN bodegas       bd  ON bd.id  = m.bodega_dest
LEFT JOIN skus          sk  ON sk.producto_id = m.producto_id AND sk.tipo = 'PRINCIPAL'
LEFT JOIN recepciones   r   ON m.referencia_tipo = 'recepcion' AND r.id = m.referencia_id
LEFT JOIN despachos     d   ON m.referencia_tipo = 'despacho'  AND d.id = m.referencia_id
ORDER BY m.creado_en DESC;

-- ══════════════════════════════════════════════════════════════
--  VIEW 3: v_alertas_stock
--  Productos con stock 0 o por debajo de mínimo.
--  Requiere columna stock_minimo en productos (se agrega si no existe).
-- ══════════════════════════════════════════════════════════════
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS stock_minimo DECIMAL(15,4) NOT NULL DEFAULT 0 COMMENT 'Nivel mínimo de reorden';

CREATE OR REPLACE VIEW v_alertas_stock AS
SELECT
  p.id                            AS producto_id,
  sk.sku,
  p.nombre                        AS producto,
  p.marca,
  b.id                            AS bodega_id,
  b.nombre                        AS bodega,
  COALESCE(SUM(s.cantidad - s.reservada), 0) AS qty_disponible,
  p.stock_minimo,
  CASE
    WHEN COALESCE(SUM(s.cantidad - s.reservada), 0) <= 0         THEN 'AGOTADO'
    WHEN COALESCE(SUM(s.cantidad - s.reservada), 0) < p.stock_minimo THEN 'BAJO_MINIMO'
    ELSE 'OK'
  END                             AS alerta
FROM productos p
CROSS JOIN bodegas b
LEFT JOIN stock s ON s.producto_id = p.id AND s.bodega_id = b.id
LEFT JOIN skus  sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL'
WHERE p.activo    = 1
  AND b.activa    = 1
  AND p.control_stock = 1
GROUP BY p.id, b.id
HAVING alerta <> 'OK';

-- ══════════════════════════════════════════════════════════════
--  VIEW 4: v_vencimientos_proximos
--  Lotes con vencimiento en los próximos 60 días
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_vencimientos_proximos AS
SELECT
  p.id                                AS producto_id,
  sk.sku,
  p.nombre                            AS producto,
  b.nombre                            AS bodega,
  u.codigo                            AS ubicacion,
  s.lote,
  s.fecha_venc,
  DATEDIFF(s.fecha_venc, CURDATE())   AS dias_para_vencer,
  (s.cantidad - s.reservada)          AS qty_disponible,
  CASE
    WHEN s.fecha_venc < CURDATE()     THEN 'VENCIDO'
    WHEN DATEDIFF(s.fecha_venc, CURDATE()) <= 15 THEN 'CRITICO'
    WHEN DATEDIFF(s.fecha_venc, CURDATE()) <= 30 THEN 'URGENTE'
    ELSE 'PROXIMO'
  END                                 AS prioridad
FROM stock s
JOIN productos   p  ON p.id = s.producto_id
JOIN bodegas     b  ON b.id = s.bodega_id
LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
LEFT JOIN skus   sk ON sk.producto_id = s.producto_id AND sk.tipo = 'PRINCIPAL'
WHERE s.fecha_venc IS NOT NULL
  AND s.fecha_venc <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
  AND s.cantidad > 0
  AND p.activo = 1
ORDER BY s.fecha_venc ASC;

-- ══════════════════════════════════════════════════════════════
--  VIEW 5: v_recepciones_detalle
--  Recepciones con sus ítems y datos legibles
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_recepciones_detalle AS
SELECT
  r.id                              AS recepcion_id,
  r.numero,
  r.estado,
  t.nombre                          AS proveedor,
  t.identification                  AS proveedor_nit,
  b.nombre                          AS bodega,
  ri.id                             AS item_id,
  p.id                              AS producto_id,
  sk.sku,
  p.nombre                          AS producto,
  ri.lote,
  ri.fecha_venc,
  ri.cantidad_esp,
  ri.cantidad_rec,
  (ri.cantidad_rec - ri.cantidad_esp) AS diferencia,
  ri.precio_unitario,
  (ri.cantidad_rec * ri.precio_unitario) AS subtotal,
  u2.nombre                         AS usuario_receptor,
  r.siigo_purchase_id,
  r.siigo_purchase_name,
  r.creado_en
FROM recepciones r
JOIN recepcion_items ri ON ri.recepcion_id = r.id
JOIN productos       p  ON p.id  = ri.producto_id
JOIN bodegas         b  ON b.id  = r.bodega_id
JOIN usuarios        u2 ON u2.id = r.usuario_id
LEFT JOIN terceros   t  ON t.id  = r.tercero_id
LEFT JOIN skus       sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL';

-- ══════════════════════════════════════════════════════════════
--  VIEW 6: v_despachos_detalle
--  Despachos con sus ítems, cliente y estado DIAN
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_despachos_detalle AS
SELECT
  d.id                              AS despacho_id,
  d.numero,
  d.estado,
  t.nombre                          AS cliente,
  t.identification                  AS cliente_nit,
  b.nombre                          AS bodega,
  di.id                             AS item_id,
  p.id                              AS producto_id,
  sk.sku,
  p.nombre                          AS producto,
  di.lote,
  di.cantidad_sol,
  di.cantidad_des,
  (di.cantidad_sol - di.cantidad_des) AS pendiente,
  di.precio_unitario,
  di.descuento,
  (di.cantidad_des * di.precio_unitario * (1 - di.descuento/100)) AS subtotal,
  u2.nombre                         AS usuario_despachador,
  d.siigo_invoice_id,
  d.siigo_invoice_name,
  d.cufe,
  d.stamp_status,
  d.creado_en,
  d.despachado_en
FROM despachos d
JOIN despacho_items di ON di.despacho_id  = d.id
JOIN productos      p  ON p.id  = di.producto_id
JOIN bodegas        b  ON b.id  = d.bodega_id
JOIN usuarios       u2 ON u2.id = d.usuario_id
LEFT JOIN terceros  t  ON t.id  = d.tercero_id
LEFT JOIN skus      sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL';

-- ══════════════════════════════════════════════════════════════
--  VIEW 7: v_siigo_pendiente
--  Movimientos que aún no se han sincronizado con SIIGO
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_siigo_pendiente AS
SELECT
  m.id                   AS movimiento_id,
  m.tipo,
  sk.sku,
  p.nombre               AS producto,
  m.cantidad,
  m.lote,
  bo.codigo              AS bodega_origen,
  bd.codigo              AS bodega_destino,
  m.referencia_tipo,
  m.referencia_id,
  u.nombre               AS usuario,
  m.creado_en
FROM movimientos m
JOIN productos p  ON p.id  = m.producto_id
JOIN usuarios  u  ON u.id  = m.usuario_id
LEFT JOIN bodegas bo ON bo.id = m.bodega_orig
LEFT JOIN bodegas bd ON bd.id = m.bodega_dest
LEFT JOIN skus   sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL'
WHERE m.siigo_sync = 0
ORDER BY m.creado_en ASC;

-- ══════════════════════════════════════════════════════════════
--  VIEW 8: v_dashboard_resumen
--  Indicadores clave para el dashboard principal (una sola fila)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_dashboard_resumen AS
SELECT
  (SELECT COUNT(*)          FROM productos         WHERE activo = 1)                             AS total_productos,
  (SELECT COUNT(DISTINCT sku) FROM skus             WHERE activo = 1)                            AS total_skus,
  (SELECT COALESCE(SUM(cantidad - reservada), 0) FROM stock)                                    AS stock_total_unidades,
  (SELECT COUNT(*)          FROM recepciones        WHERE estado = 'completada'
                             AND DATE(creado_en) = CURDATE())                                    AS recepciones_hoy,
  (SELECT COUNT(*)          FROM despachos          WHERE estado = 'despachado'
                             AND DATE(despachado_en) = CURDATE())                                AS despachos_hoy,
  (SELECT COUNT(*)          FROM movimientos        WHERE siigo_sync = 0)                       AS pendiente_sync_siigo,
  (SELECT COUNT(*)          FROM v_alertas_stock    WHERE alerta = 'AGOTADO')                   AS productos_agotados,
  (SELECT COUNT(*)          FROM v_alertas_stock    WHERE alerta = 'BAJO_MINIMO')               AS productos_bajo_minimo,
  (SELECT COUNT(*)          FROM v_vencimientos_proximos WHERE prioridad IN ('VENCIDO','CRITICO')) AS lotes_criticos,
  NOW()                                                                                           AS generado_en;

-- ══════════════════════════════════════════════════════════════
--  ÍNDICES adicionales para performance de los VIEWs
-- ══════════════════════════════════════════════════════════════
ALTER TABLE stock
  ADD INDEX IF NOT EXISTS idx_stock_fecha_venc  (fecha_venc),
  ADD INDEX IF NOT EXISTS idx_stock_lote        (lote);

ALTER TABLE movimientos
  ADD INDEX IF NOT EXISTS idx_mov_ref   (referencia_tipo, referencia_id),
  ADD INDEX IF NOT EXISTS idx_mov_fecha (creado_en);

ALTER TABLE skus
  ADD INDEX IF NOT EXISTS idx_skus_sku  (sku);
