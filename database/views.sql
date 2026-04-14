-- ============================================================
-- 8 VIEWs WMS — kainotomia_WMS
-- Columnas alineadas con DESCRIBE real del servidor
-- Ejecuta en phpMyAdmin: pega todo junto o VIEW por VIEW
-- ============================================================

-- VIEW 1: Stock disponible con estado de vencimiento
CREATE OR REPLACE VIEW v_stock_disponible AS
SELECT
  s.id AS stock_id,
  p.id AS producto_id,
  sk.sku,
  p.nombre AS producto,
  p.referencia,
  p.barcode,
  p.marca,
  b.codigo AS bodega_codigo,
  b.nombre AS bodega,
  u.codigo AS ubicacion,
  u.zona,
  s.lote,
  s.serial,
  s.fecha_venc,
  s.cantidad AS qty_total,
  s.reservada AS qty_reservada,
  (s.cantidad - s.reservada) AS qty_disponible,
  CASE
    WHEN s.fecha_venc IS NULL THEN 'sin_vencimiento'
    WHEN s.fecha_venc < CURDATE() THEN 'vencido'
    WHEN s.fecha_venc <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'por_vencer'
    ELSE 'vigente'
  END AS estado_vencimiento,
  s.actualizado_en
FROM stock s
JOIN productos p ON p.id = s.producto_id
JOIN bodegas b ON b.id = s.bodega_id
LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
LEFT JOIN skus sk ON sk.producto_id = s.producto_id AND sk.tipo = 'PRINCIPAL'
WHERE s.cantidad > 0 AND p.activo = 1 AND b.activa = 1;

-- VIEW 2: Kardex completo
CREATE OR REPLACE VIEW v_kardex AS
SELECT
  m.id AS movimiento_id,
  m.tipo,
  p.id AS producto_id,
  sk.sku,
  p.nombre AS producto,
  bo.codigo AS bodega_origen,
  bd.codigo AS bodega_destino,
  m.lote,
  m.cantidad,
  m.referencia_tipo,
  m.referencia_id,
  COALESCE(r.numero, d.numero) AS documento_numero,
  u.nombre AS usuario,
  m.siigo_sync,
  m.siigo_voucher_id,
  m.creado_en AS fecha
FROM movimientos m
JOIN productos p ON p.id = m.producto_id
JOIN usuarios u ON u.id = m.usuario_id
LEFT JOIN bodegas bo ON bo.id = m.bodega_orig
LEFT JOIN bodegas bd ON bd.id = m.bodega_dest
LEFT JOIN skus sk ON sk.producto_id = m.producto_id AND sk.tipo = 'PRINCIPAL'
LEFT JOIN recepciones r ON m.referencia_tipo = 'recepcion' AND r.id = m.referencia_id
LEFT JOIN despachos d ON m.referencia_tipo = 'despacho' AND d.id = m.referencia_id
ORDER BY m.creado_en DESC;

-- VIEW 3: Alertas de stock bajo mínimo
CREATE OR REPLACE VIEW v_alertas_stock AS
SELECT
  p.id AS producto_id,
  sk.sku,
  p.nombre AS producto,
  p.marca,
  b.id AS bodega_id,
  b.nombre AS bodega,
  COALESCE(SUM(s.cantidad - s.reservada), 0) AS qty_disponible,
  p.stock_minimo,
  CASE
    WHEN COALESCE(SUM(s.cantidad - s.reservada), 0) = 0 THEN 'AGOTADO'
    WHEN COALESCE(SUM(s.cantidad - s.reservada), 0) < p.stock_minimo THEN 'BAJO_MINIMO'
    ELSE 'OK'
  END AS alerta
FROM productos p
CROSS JOIN bodegas b
LEFT JOIN stock s ON s.producto_id = p.id AND s.bodega_id = b.id
LEFT JOIN skus sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL'
WHERE p.activo = 1 AND b.activa = 1 AND p.control_stock = 1
GROUP BY p.id, b.id
HAVING alerta <> 'OK';

-- VIEW 4: Vencimientos próximos (60 días)
CREATE OR REPLACE VIEW v_vencimientos_proximos AS
SELECT
  p.id AS producto_id,
  sk.sku,
  p.nombre AS producto,
  b.nombre AS bodega,
  u.codigo AS ubicacion,
  s.lote,
  s.fecha_venc,
  DATEDIFF(s.fecha_venc, CURDATE()) AS dias_para_vencer,
  (s.cantidad - s.reservada) AS qty_disponible,
  CASE
    WHEN s.fecha_venc < CURDATE() THEN 'VENCIDO'
    WHEN DATEDIFF(s.fecha_venc, CURDATE()) <= 15 THEN 'CRITICO'
    WHEN DATEDIFF(s.fecha_venc, CURDATE()) <= 30 THEN 'URGENTE'
    ELSE 'PROXIMO'
  END AS prioridad
FROM stock s
JOIN productos p ON p.id = s.producto_id
JOIN bodegas b ON b.id = s.bodega_id
LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
LEFT JOIN skus sk ON sk.producto_id = s.producto_id AND sk.tipo = 'PRINCIPAL'
WHERE s.fecha_venc IS NOT NULL
  AND s.fecha_venc <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
  AND s.cantidad > 0
  AND p.activo = 1
ORDER BY s.fecha_venc ASC;

-- VIEW 5: Recepciones detalle
CREATE OR REPLACE VIEW v_recepciones_detalle AS
SELECT
  r.id AS recepcion_id,
  r.numero,
  r.estado,
  t.nombre AS proveedor,
  t.identification AS proveedor_nit,
  b.nombre AS bodega,
  ri.id AS item_id,
  p.id AS producto_id,
  sk.sku,
  p.nombre AS producto,
  ri.lote,
  ri.fecha_venc,
  ri.cantidad_esp,
  ri.cantidad_rec,
  (ri.cantidad_rec - ri.cantidad_esp) AS diferencia,
  ri.precio_unitario,
  (ri.cantidad_rec * ri.precio_unitario) AS subtotal,
  u2.nombre AS usuario_receptor,
  r.siigo_purchase_id,
  r.siigo_purchase_name,
  r.creado_en
FROM recepciones r
JOIN recepcion_items ri ON ri.recepcion_id = r.id
JOIN productos p ON p.id = ri.producto_id
JOIN bodegas b ON b.id = r.bodega_id
JOIN usuarios u2 ON u2.id = r.usuario_id
LEFT JOIN terceros t ON t.id = r.tercero_id
LEFT JOIN skus sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL';

-- VIEW 6: Despachos detalle
CREATE OR REPLACE VIEW v_despachos_detalle AS
SELECT
  d.id AS despacho_id,
  d.numero,
  d.estado,
  t.nombre AS cliente,
  t.identification AS cliente_nit,
  b.nombre AS bodega,
  di.id AS item_id,
  p.id AS producto_id,
  sk.sku,
  p.nombre AS producto,
  di.lote,
  di.cantidad_sol,
  di.cantidad_des,
  (di.cantidad_sol - di.cantidad_des) AS pendiente,
  di.precio_unitario,
  di.descuento,
  (di.cantidad_des * di.precio_unitario * (1 - di.descuento/100)) AS subtotal,
  u2.nombre AS usuario_despachador,
  d.siigo_invoice_id,
  d.siigo_invoice_name,
  d.cufe,
  d.stamp_status,
  d.creado_en,
  d.despachado_en
FROM despachos d
JOIN despacho_items di ON di.despacho_id = d.id
JOIN productos p ON p.id = di.producto_id
JOIN bodegas b ON b.id = d.bodega_id
JOIN usuarios u2 ON u2.id = d.usuario_id
LEFT JOIN terceros t ON t.id = d.tercero_id
LEFT JOIN skus sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL';

-- VIEW 7: Movimientos pendientes de sync SIIGO
CREATE OR REPLACE VIEW v_siigo_pendiente AS
SELECT
  m.id AS movimiento_id,
  m.tipo,
  sk.sku,
  p.nombre AS producto,
  m.cantidad,
  m.lote,
  bo.codigo AS bodega_origen,
  bd.codigo AS bodega_destino,
  m.referencia_tipo,
  m.referencia_id,
  u.nombre AS usuario,
  m.creado_en
FROM movimientos m
JOIN productos p ON p.id = m.producto_id
JOIN usuarios u ON u.id = m.usuario_id
LEFT JOIN bodegas bo ON bo.id = m.bodega_orig
LEFT JOIN bodegas bd ON bd.id = m.bodega_dest
LEFT JOIN skus sk ON sk.producto_id = p.id AND sk.tipo = 'PRINCIPAL'
WHERE m.siigo_sync = 0
ORDER BY m.creado_en ASC;

-- VIEW 8: Dashboard resumen
CREATE OR REPLACE VIEW v_dashboard_resumen AS
SELECT
  (SELECT COUNT(*) FROM productos WHERE activo = 1) AS total_productos,
  (SELECT COUNT(DISTINCT sku) FROM skus WHERE activo = 1) AS total_skus,
  (SELECT COALESCE(SUM(cantidad - reservada), 0) FROM stock) AS stock_total_unidades,
  (SELECT COUNT(*) FROM recepciones WHERE estado = 'completada' AND DATE(creado_en) = CURDATE()) AS recepciones_hoy,
  (SELECT COUNT(*) FROM despachos WHERE estado = 'despachado' AND DATE(despachado_en) = CURDATE()) AS despachos_hoy,
  (SELECT COUNT(*) FROM movimientos WHERE siigo_sync = 0) AS pendiente_sync_siigo,
  (SELECT COUNT(*) FROM v_alertas_stock WHERE alerta = 'AGOTADO') AS productos_agotados,
  (SELECT COUNT(*) FROM v_alertas_stock WHERE alerta = 'BAJO_MINIMO') AS productos_bajo_minimo,
  (SELECT COUNT(*) FROM v_vencimientos_proximos WHERE prioridad IN ('VENCIDO','CRITICO')) AS lotes_criticos,
  NOW() AS generado_en;

-- Verificar
SHOW FULL TABLES IN kainotomia_WMS WHERE TABLE_TYPE = 'VIEW';
