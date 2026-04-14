-- ============================================================
-- SEED DEMO kainotomia_WMS  — April 2026
-- Ejecuta TODO de una sola vez en phpMyAdmin
-- Usa INSERT IGNORE para no romper si ya hay datos
-- ============================================================

-- ------------------------------------------------------------
-- 1. BODEGAS
-- ------------------------------------------------------------
INSERT IGNORE INTO bodegas (id, codigo, nombre, direccion, activa) VALUES
(1, 'BG-PPAL', 'Bodega Principal', 'Calle 10 # 20-30, Bogotá', 1),
(2, 'BG-CUAR', 'Cuarentena', 'Calle 10 # 20-30, Bodega 2', 1);

-- ------------------------------------------------------------
-- 2. UBICACIONES
-- ------------------------------------------------------------
INSERT IGNORE INTO ubicaciones (id, bodega_id, codigo, zona, pasillo, nivel, activa) VALUES
(1, 1, 'A-01-01', 'A', '01', '01', 1),
(2, 1, 'A-01-02', 'A', '01', '02', 1),
(3, 1, 'B-02-01', 'B', '02', '01', 1),
(4, 2, 'CU-01-01', 'CUARENTENA', '01', '01', 1);

-- ------------------------------------------------------------
-- 3. USUARIOS  (password = Test1234!  → bcrypt hash)
-- ------------------------------------------------------------
INSERT IGNORE INTO usuarios (id, nombre, email, password_hash, rol_id, activo) VALUES
(1, 'Admin WMS',    'admin@wms.co',   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1, 1),
(2, 'Carlos Bodega','carlos@wms.co',  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 3, 1),
(3, 'Laura Sup',    'laura@wms.co',   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 2, 1),
(4, 'Bot WMS',      'bot@wms.co',     '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 3, 1);

-- ------------------------------------------------------------
-- 4. TERCEROS (proveedores y clientes)
-- ------------------------------------------------------------
INSERT IGNORE INTO terceros (id, tipo, person_type, id_type, identification, nombre, activo, creado_en) VALUES
(1, 'Supplier', 'company', '31', '900123456', 'Proveedor Demo SAS',   1, NOW()),
(2, 'Customer', 'company', '31', '800987654', 'Cliente GymPro SAS',   1, NOW()),
(3, 'Customer', 'company', '31', '900555111', 'Farmatodo Colombia',   1, NOW());

-- ------------------------------------------------------------
-- 5. PRODUCTOS
-- ------------------------------------------------------------
INSERT IGNORE INTO productos (id, siigo_code, nombre, descripcion, tipo_producto, control_stock, activo, requiere_lote, unit_label, stock_minimo, precio_venta) VALUES
(1, 'RM-GOM-CREA',  'Gelatina sin sabor 25kg',    'Materia prima gelificante',  'Product', 1, 1, 1, 'kg',  50.0000, 85000.00),
(2, 'RM-AZU-25K',   'Azúcar refinada 25kg',       'Materia prima edulcorante',  'Product', 1, 1, 1, 'kg',  100.0000, 32000.00),
(3, 'RM-BOT-500',   'Botella PET 500ml',           'Empaque primario',           'Product', 1, 1, 0, 'und', 200.0000, 350.00),
(4, 'RM-TAP-MED',   'Tapa rosca mediana',          'Empaque tapas',              'Product', 1, 1, 0, 'und', 500.0000, 50.00),
(5, 'FG-VITC-30',   'Gomitas Vitamina C x30',      'Producto terminado',         'Product', 1, 1, 1, 'und', 20.0000,  15500.00),
(6, 'FG-CREA-10',   'Gomitas Creatina x10',        'Producto terminado',         'Product', 1, 1, 1, 'und', 10.0000,  22000.00);

-- ------------------------------------------------------------
-- 6. SKUs PRINCIPALES
-- ------------------------------------------------------------
INSERT IGNORE INTO skus (producto_id, sku, tipo, descripcion, unidad, factor_conv, activo) VALUES
(1, 'RM-GOM-CREA', 'PRINCIPAL', 'Gelatina sin sabor 25kg',   'kg',  1.000000, 1),
(2, 'RM-AZU-25K',  'PRINCIPAL', 'Azúcar refinada 25kg',      'kg',  1.000000, 1),
(3, 'RM-BOT-500',  'PRINCIPAL', 'Botella PET 500ml',          'und', 1.000000, 1),
(4, 'RM-TAP-MED',  'PRINCIPAL', 'Tapa rosca mediana',         'und', 1.000000, 1),
(5, 'FG-VITC-30',  'PRINCIPAL', 'Gomitas Vitamina C x30',    'und', 1.000000, 1),
(6, 'FG-CREA-10',  'PRINCIPAL', 'Gomitas Creatina x10',      'und', 1.000000, 1);

-- ------------------------------------------------------------
-- 7. STOCK  (lotes con cantidades reales)
-- ------------------------------------------------------------
INSERT IGNORE INTO stock (id, producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada) VALUES
(1,  1, 1, 1, 'L-2026-001', '2027-06-30', 250.0000, 0.0000),
(2,  2, 1, 1, 'L-2026-002', '2027-12-31', 500.0000, 50.0000),
(3,  3, 1, 2, 'L-2026-003', NULL,         1500.0000, 200.0000),
(4,  4, 1, 2, 'L-2026-004', NULL,         3000.0000, 0.0000),
(5,  5, 1, 3, 'L-2026-005', '2026-12-31', 80.0000,  10.0000),
(6,  6, 1, 3, 'L-2026-006', '2026-11-30', 45.0000,  5.0000),
(7,  1, 2, 4, 'L-2026-099', '2027-03-15', 75.0000,  0.0000),
(8,  3, 1, 2, 'L-2026-010', NULL,         120.0000, 0.0000);

-- ------------------------------------------------------------
-- 8. RECEPCIONES
-- ------------------------------------------------------------
INSERT IGNORE INTO recepciones (id, numero, tercero_id, proveedor_nombre, bodega_id, estado, usuario_id, observaciones, moneda, creado_en) VALUES
(1, 'REC-2026-001', 1, 'Proveedor Demo SAS', 1, 'completada', 2, 'Recepción inicial de materias primas', 'COP', '2026-01-10 09:00:00'),
(2, 'REC-2026-002', 1, 'Proveedor Demo SAS', 1, 'completada', 2, 'Reposición botellas y tapas', 'COP', '2026-02-15 10:30:00'),
(3, 'REC-2026-003', 1, 'Proveedor Demo SAS', 2, 'en_proceso', 2, 'Lote en cuarentena pendiente liberación', 'COP', '2026-04-12 08:00:00');

INSERT IGNORE INTO recepcion_items (recepcion_id, producto_id, ubicacion_id, lote, fecha_venc, cantidad_esp, cantidad_rec, precio_unitario) VALUES
(1, 1, 1, 'L-2026-001', '2027-06-30', 250.0000, 250.0000, 83000.000000),
(1, 2, 1, 'L-2026-002', '2027-12-31', 500.0000, 500.0000, 31500.000000),
(2, 3, 2, 'L-2026-003', NULL,         2000.0000, 1500.0000, 340.000000),
(2, 4, 2, 'L-2026-004', NULL,         3000.0000, 3000.0000, 48.000000),
(3, 1, 4, 'L-2026-099', '2027-03-15', 75.0000,  75.0000, 83000.000000);

-- ------------------------------------------------------------
-- 9. DESPACHOS
-- ------------------------------------------------------------
INSERT IGNORE INTO despachos (id, numero, tercero_id, cliente_nombre, bodega_id, estado, usuario_id, observaciones, moneda, creado_en) VALUES
(1, 'DSP-2026-001', 2, 'Cliente GymPro SAS', 1, 'despachado', 2, 'Pedido urgente gomitas',    'COP', '2026-03-05 14:00:00'),
(2, 'DSP-2026-002', 3, 'Farmatodo Colombia', 1, 'borrador',    3, 'Pendiente aprobación',      'COP', '2026-04-13 09:00:00');

INSERT IGNORE INTO despacho_items (despacho_id, producto_id, ubicacion_id, lote, cantidad_sol, cantidad_des, precio_unitario, descuento) VALUES
(1, 5, 3, 'L-2026-005', 30.0000, 30.0000, 15500.000000, 0.00),
(2, 6, 3, 'L-2026-006', 20.0000,  0.0000, 22000.000000, 5.00);

-- ------------------------------------------------------------
-- 10. MOVIMIENTOS (kardex)
-- ------------------------------------------------------------
INSERT IGNORE INTO movimientos (id, tipo, producto_id, bodega_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id, siigo_sync, creado_en) VALUES
(1,  'entrada', 1, 1, 'L-2026-001', 250.0000,  1, 'recepcion', 2, 0, '2026-01-10 09:15:00'),
(2,  'entrada', 2, 1, 'L-2026-002', 500.0000,  1, 'recepcion', 2, 0, '2026-01-10 09:20:00'),
(3,  'entrada', 3, 1, 'L-2026-003', 1500.0000, 2, 'recepcion', 2, 0, '2026-02-15 10:45:00'),
(4,  'entrada', 4, 1, 'L-2026-004', 3000.0000, 2, 'recepcion', 2, 0, '2026-02-15 10:50:00'),
(5,  'entrada', 1, 2, 'L-2026-099', 75.0000,   3, 'recepcion', 2, 0, '2026-04-12 08:30:00'),
(6,  'salida',  5, NULL,'L-2026-005',30.0000,  1, 'despacho',  2, 0, '2026-03-05 14:30:00'),
(7,  'ajuste',  4, 1, 'L-2026-004', 200.0000,  NULL,'ajuste',  3, 0, '2026-03-20 11:00:00'),
(8,  'entrada', 5, 1, 'L-2026-005', 80.0000,   NULL,'ajuste',  3, 0, '2026-03-01 08:00:00'),
(9,  'entrada', 6, 1, 'L-2026-006', 45.0000,   NULL,'ajuste',  3, 0, '2026-03-01 08:05:00'),
(10, 'ajuste',  3, 1, 'L-2026-003', -500.0000, NULL,'ajuste',  1, 0, '2026-04-01 10:00:00');

-- ------------------------------------------------------------
-- 11. WEBHOOK LOGS
-- ------------------------------------------------------------
INSERT IGNORE INTO webhook_logs (id, from_phone, action, priority, payload, response, status, created_at) VALUES
(1, '573001234567', 'CONSULTAR_STOCK_MATERIA_PRIMA', 'baja',
  '{"kw":"g0ms","action":"CONSULTAR_STOCK_MATERIA_PRIMA","params":{"id_item":"RM-GOM-CREA"}}',
  '{"ok":true,"message":"Stock disponible: 250 kg en L-2026-001"}',
  'PROCESSED', '2026-04-13 08:10:00'),
(2, '573001234567', 'SOLICITAR_INICIO_PRODUCCION', 'alta',
  '{"kw":"g0ms","action":"SOLICITAR_INICIO_PRODUCCION","params":{"id_producto_final":"FG-VITC-30","cantidad_deseada":50}}',
  '{"ok":true,"message":"Orden ORD-2026-001 creada, pendiente aprobación"}',
  'PROCESSED', '2026-04-13 09:05:00'),
(3, '573009876543', 'SOLICITAR_DESPACHO', 'alta',
  '{"kw":"g0ms","action":"SOLICITAR_DESPACHO","params":{"id_lote":"L-2026-006","cantidad":20,"cliente_destino":"Farmatodo"}}',
  '{"ok":true,"message":"Despacho DSP-2026-002 creado, pendiente aprobación"}',
  'PROCESSED', '2026-04-13 09:30:00'),
(4, '573001234567', 'CONSULTAR_ESTADO_PRODUCCION', 'baja',
  '{"kw":"g0ms","action":"CONSULTAR_ESTADO_PRODUCCION","params":{"id_orden":"ORD-2026-001"}}',
  '{"ok":true,"message":"Orden en fase F1 - Pesaje"}',
  'PROCESSED', '2026-04-13 10:00:00'),
(5, '573001112222', 'INGRESO_RECEPCION', 'media',
  '{"kw":"g0ms","action":"INGRESO_RECEPCION","params":{"id_item":"RM-BOT-500","qty_buenas":75,"id_proveedor":"900123456"}}',
  '{"ok":false,"error":"Lote en cuarentena — producto sin liberación QA"}',
  'REJECTED', '2026-04-12 08:05:00'),
(6, '573001234567', 'CONSULTAR_TRAZABILIDAD_LOTE', 'baja',
  '{"kw":"g0ms","action":"CONSULTAR_TRAZABILIDAD_LOTE","params":{"id_lote":"L-2026-099"}}',
  '{"ok":true,"message":"Lote en cuarentena desde 2026-04-12. Bodega: BG-CUAR"}',
  'PROCESSED', '2026-04-14 07:45:00');

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT 'bodegas'          AS tabla, COUNT(*) AS registros FROM bodegas
UNION ALL SELECT 'ubicaciones',     COUNT(*) FROM ubicaciones
UNION ALL SELECT 'usuarios',        COUNT(*) FROM usuarios
UNION ALL SELECT 'terceros',        COUNT(*) FROM terceros
UNION ALL SELECT 'productos',       COUNT(*) FROM productos
UNION ALL SELECT 'skus',            COUNT(*) FROM skus
UNION ALL SELECT 'stock',           COUNT(*) FROM stock
UNION ALL SELECT 'recepciones',     COUNT(*) FROM recepciones
UNION ALL SELECT 'recepcion_items', COUNT(*) FROM recepcion_items
UNION ALL SELECT 'despachos',       COUNT(*) FROM despachos
UNION ALL SELECT 'despacho_items',  COUNT(*) FROM despacho_items
UNION ALL SELECT 'movimientos',     COUNT(*) FROM movimientos
UNION ALL SELECT 'webhook_logs',    COUNT(*) FROM webhook_logs;
