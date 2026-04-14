-- ============================================================
-- SEED DEMO ROBUSTO — kainotomia_WMS
-- Cubre TODOS los flujos de negocio del WMS
-- Usa INSERT IGNORE — seguro de ejecutar múltiples veces
-- Orden: bodegas → ubicaciones → usuarios → terceros →
--        productos → skus → stock → recepciones →
--        despachos → movimientos → webhook_logs
-- ============================================================

-- ============================================================
-- 1. BODEGAS
-- ============================================================
INSERT IGNORE INTO bodegas (id, codigo, nombre, direccion, activa, siigo_id) VALUES
(1, 'BG-PPAL',  'Bodega Principal',       'Calle 10 # 20-30, Bogotá',  1, 101),
(2, 'BG-CUAR',  'Cuarentena',             'Calle 10 # 20-30, Zona 2',  1, 102),
(3, 'BG-DEVOL', 'Devoluciones',           'Calle 10 # 20-30, Zona 3',  1, 103),
(4, 'BG-PROD',  'Bodega Producción WIP',  'Calle 10 # 20-30, Zona 4',  1, 104);

-- ============================================================
-- 2. UBICACIONES
-- ============================================================
INSERT IGNORE INTO ubicaciones (id, bodega_id, codigo, zona, pasillo, nivel, activa) VALUES
-- Bodega Principal
(1,  1, 'A-01-01', 'A', '01', '01', 1),
(2,  1, 'A-01-02', 'A', '01', '02', 1),
(3,  1, 'A-02-01', 'A', '02', '01', 1),
(4,  1, 'B-01-01', 'B', '01', '01', 1),
(5,  1, 'B-01-02', 'B', '01', '02', 1),
(6,  1, 'B-02-01', 'B', '02', '01', 1),
(7,  1, 'C-01-01', 'C', '01', '01', 1),
-- Cuarentena
(8,  2, 'CU-01-01', 'CUARENTENA', '01', '01', 1),
(9,  2, 'CU-01-02', 'CUARENTENA', '01', '02', 1),
-- Devoluciones
(10, 3, 'DV-01-01', 'DEVOLUCION', '01', '01', 1),
-- Producción WIP
(11, 4, 'WIP-01',   'WIP', '01', '01', 1),
(12, 4, 'WIP-02',   'WIP', '02', '01', 1);

-- ============================================================
-- 3. USUARIOS
-- Contraseña de todos: Test1234!
-- Hash bcrypt de "Test1234!" generado con saltRounds=10
-- ============================================================
INSERT IGNORE INTO usuarios (id, nombre, email, password_hash, rol_id, activo) VALUES
(1, 'Admin WMS',      'admin@wms.co',    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 1, 1),
(2, 'Carlos Jiménez', 'carlos@wms.co',   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 3, 1),
(3, 'Laura Martínez', 'laura@wms.co',    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 2, 1),
(4, 'Pedro Ramírez',  'pedro@wms.co',    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 3, 1),
(5, 'Bot BuilderBot', 'bot@wms.co',      '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 3, 1);

-- ============================================================
-- 4. TERCEROS — Proveedores y Clientes
-- ============================================================
INSERT IGNORE INTO terceros (id, tipo, person_type, id_type, identification, nombre, nombre_comercial, telefono, email_contacto, activo, vat_responsible, responsabilidad_fiscal, creado_en) VALUES
-- Proveedores
(1, 'Supplier', 'company', '31', '900123456', 'Ingredientes Naturales SAS',  'Ingredientes SAS',  '6015551001', 'compras@ingredientes.co',  1, 1, 'O-13', NOW()),
(2, 'Supplier', 'company', '31', '800456789', 'Empaques del Valle SAS',      'Empaques Valle',    '6025552002', 'ventas@empaquesvalle.co',  1, 1, 'O-13', NOW()),
(3, 'Supplier', 'company', '31', '900987001', 'Química Industrial Ltda',     'QuimInd',           '6015553003', 'info@quimica.co',          1, 0, 'R-99-PN', NOW()),
-- Clientes
(4, 'Customer', 'company', '31', '800987654', 'GymPro Colombia SAS',         'GymPro',            '3001234567', 'pedidos@gympro.co',        1, 1, 'O-13', NOW()),
(5, 'Customer', 'company', '31', '900555111', 'Farmatodo Colombia SA',       'Farmatodo',         '6015556000', 'compras@farmatodo.co',     1, 1, 'O-13', NOW()),
(6, 'Customer', 'person',  '13', '79854321',  'Juan Pérez Distribuciones',   NULL,                '3109876543', 'juanp@gmail.com',          1, 0, 'R-99-PN', NOW()),
(7, 'Customer', 'company', '31', '900111222', 'Suplementos Online SAS',      'SuplementosOnline', '3201112222', 'pedidos@suponline.co',     1, 1, 'O-13', NOW());

-- ============================================================
-- 5. PRODUCTOS — Materias primas, Insumos, Empaques, PT
-- ============================================================
INSERT IGNORE INTO productos (id, siigo_code, nombre, descripcion, tipo_producto, control_stock, activo, requiere_lote, requiere_serial, unit_label, stock_minimo, precio_venta, tax_classification, peso_kg) VALUES
-- MATERIAS PRIMAS
(1,  'RM-GEL-25K', 'Gelatina sin sabor 25kg',      'Gelificante base para gomitas',           'Product', 1, 1, 1, 0, 'kg',   50.00, 85000.00,  'Taxed',  25.000),
(2,  'RM-AZU-25K', 'Azúcar refinada 25kg',          'Edulcorante principal',                   'Product', 1, 1, 1, 0, 'kg',  100.00, 32000.00,  'Taxed',  25.000),
(3,  'RM-CIT-5K',  'Ácido cítrico 5kg',              'Acidulante conservante',                 'Product', 1, 1, 1, 0, 'kg',   20.00, 48000.00,  'Taxed',   5.000),
(4,  'RM-VITC-1K', 'Vitamina C polvo 1kg',           'Activo nutricional vitamínico',          'Product', 1, 1, 1, 0, 'kg',   10.00, 320000.00, 'Taxed',   1.000),
(5,  'RM-CREA-1K', 'Creatina monohidrato 1kg',       'Activo nutricional fuerza',              'Product', 1, 1, 1, 0, 'kg',    5.00, 180000.00, 'Taxed',   1.000),
(6,  'RM-COLA-1K', 'Colágeno hidrolizado 1kg',       'Activo nutricional colágeno',            'Product', 1, 1, 1, 0, 'kg',    5.00, 210000.00, 'Taxed',   1.000),
-- EMPAQUES
(7,  'EM-BOT-500', 'Botella PET 500ml c/tapa',       'Envase primario 500ml con tapa',         'Product', 1, 1, 0, 0, 'und', 500.00,    380.00,  'Exempt',  0.025),
(8,  'EM-BOT-250', 'Botella PET 250ml c/tapa',       'Envase primario 250ml con tapa',         'Product', 1, 1, 0, 0, 'und', 300.00,    280.00,  'Exempt',  0.015),
(9,  'EM-DOYP-LG', 'Doypack 500g zipper',            'Empaque flexible grande',                'Product', 1, 1, 0, 0, 'und', 200.00,    450.00,  'Exempt',  0.020),
(10, 'EM-ETI-A4',  'Etiqueta adhesiva A4 hoja x50', 'Papel etiqueta BOPP imprimible',         'Product', 1, 1, 0, 0, 'hoj', 100.00,   1800.00,  'Taxed',   0.005),
-- INSUMOS
(11, 'IN-GUA-LP',  'Guante látex par',               'EPP operario',                            'Product', 1, 1, 0, 0, 'par',  50.00,    850.00,  'Taxed',   0.050),
(12, 'IN-BOL-ZIP', 'Bolsa ziplock 15x20cm x100',     'Insumo empaque secundario',              'Product', 1, 1, 0, 0, 'paq',  30.00,   4200.00,  'Exempt',  0.100),
-- PRODUCTOS TERMINADOS
(13, 'PT-VITC-30', 'Gomitas Vitamina C x30 uds',     '30 gomitas 2g c/u sabor naranja',        'Product', 1, 1, 1, 0, 'und',  20.00,  15500.00,  'Taxed',   0.070),
(14, 'PT-CREA-10', 'Gomitas Creatina x10 uds',       '10 gomitas 5g c/u sabor fresa',          'Product', 1, 1, 1, 0, 'und',  10.00,  22000.00,  'Taxed',   0.055),
(15, 'PT-COLA-20', 'Gomitas Colágeno x20 uds',       '20 gomitas 3g c/u sabor uva',            'Product', 1, 1, 1, 0, 'und',  15.00,  19000.00,  'Taxed',   0.068),
(16, 'PT-MIXB-60', 'Mix Bienestar x60 uds',          '60 gomitas mix multivitamínico',         'Product', 1, 1, 1, 0, 'und',   8.00,  38000.00,  'Taxed',   0.145);

-- ============================================================
-- 6. SKUs PRINCIPALES
-- ============================================================
INSERT IGNORE INTO skus (producto_id, sku, tipo, descripcion, unidad, factor_conv, activo) VALUES
(1,  'RM-GEL-25K', 'PRINCIPAL', 'Gelatina sin sabor 25kg',      'kg',  1.000000, 1),
(2,  'RM-AZU-25K', 'PRINCIPAL', 'Azúcar refinada 25kg',         'kg',  1.000000, 1),
(3,  'RM-CIT-5K',  'PRINCIPAL', 'Ácido cítrico 5kg',            'kg',  1.000000, 1),
(4,  'RM-VITC-1K', 'PRINCIPAL', 'Vitamina C polvo 1kg',         'kg',  1.000000, 1),
(5,  'RM-CREA-1K', 'PRINCIPAL', 'Creatina monohidrato 1kg',     'kg',  1.000000, 1),
(6,  'RM-COLA-1K', 'PRINCIPAL', 'Colágeno hidrolizado 1kg',     'kg',  1.000000, 1),
(7,  'EM-BOT-500', 'PRINCIPAL', 'Botella PET 500ml c/tapa',     'und', 1.000000, 1),
(8,  'EM-BOT-250', 'PRINCIPAL', 'Botella PET 250ml c/tapa',     'und', 1.000000, 1),
(9,  'EM-DOYP-LG', 'PRINCIPAL', 'Doypack 500g zipper',         'und', 1.000000, 1),
(10, 'EM-ETI-A4',  'PRINCIPAL', 'Etiqueta adhesiva A4',         'hoj', 1.000000, 1),
(11, 'IN-GUA-LP',  'PRINCIPAL', 'Guante látex par',             'par', 1.000000, 1),
(12, 'IN-BOL-ZIP', 'PRINCIPAL', 'Bolsa ziplock 15x20cm x100',  'paq', 1.000000, 1),
(13, 'PT-VITC-30', 'PRINCIPAL', 'Gomitas Vitamina C x30',      'und', 1.000000, 1),
(14, 'PT-CREA-10', 'PRINCIPAL', 'Gomitas Creatina x10',        'und', 1.000000, 1),
(15, 'PT-COLA-20', 'PRINCIPAL', 'Gomitas Colágeno x20',        'und', 1.000000, 1),
(16, 'PT-MIXB-60', 'PRINCIPAL', 'Mix Bienestar x60',           'und', 1.000000, 1),
-- SKU alterno (código de barras proveedor)
(1,  'GEL-PROV-001', 'PROVEEDOR', 'Código proveedor Ingredientes SAS', 'kg', 1.000000, 1),
(7,  '7702650001234','BARCODE',   'EAN13 Botella PET 500ml',           'und', 1.000000, 1),
(13, '7702650013014','BARCODE',   'EAN13 Gomitas Vitamina C',          'und', 1.000000, 1);

-- ============================================================
-- 7. STOCK — Estado real al momento del seed
-- ============================================================
INSERT IGNORE INTO stock (id, producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada) VALUES
-- Materias primas disponibles
(1,  1,  1, 1, 'L-2026-001', '2028-01-31', 320.0000,   0.0000),  -- Gelatina OK
(2,  2,  1, 1, 'L-2026-002', '2028-06-30', 600.0000,  75.0000),  -- Azúcar (75kg reservada producción)
(3,  3,  1, 2, 'L-2026-003', '2027-09-30',  48.0000,   0.0000),  -- Ácido cítrico OK
(4,  4,  1, 2, 'L-2026-004', '2027-12-31',  18.0000,   5.0000),  -- Vitamina C (bajo mínimo=10, disponible=13)
(5,  5,  1, 3, 'L-2026-005', '2027-11-30',   8.5000,   0.0000),  -- Creatina BAJO MÍNIMO (min=5, disponible=8.5)
(6,  6,  1, 3, 'L-2026-006', '2027-10-31',   3.0000,   0.0000),  -- Colágeno BAJO MÍNIMO (min=5 → AGOTADO disponible)
-- Empaques
(7,  7,  1, 4, 'L-2026-007', NULL,         2800.0000, 500.0000), -- Botellas 500ml (500 reservadas despacho)
(8,  8,  1, 4, 'L-2026-008', NULL,         1500.0000,   0.0000), -- Botellas 250ml
(9,  9,  1, 5, 'L-2026-009', NULL,          850.0000,   0.0000), -- Doypacks
(10, 10, 1, 5, 'L-2026-010', NULL,          420.0000,   0.0000), -- Etiquetas
(11, 11, 1, 6, 'L-2026-011', NULL,          180.0000,   0.0000), -- Guantes
(12, 12, 1, 6, 'L-2026-012', NULL,           45.0000,   0.0000), -- Bolsas zip
-- Productos terminados
(13, 13, 1, 7, 'PT-2026-001', '2026-12-31', 150.0000,  30.0000), -- Gomitas VitC (30 reservadas despacho)
(14, 14, 1, 7, 'PT-2026-002', '2026-11-30',  65.0000,  20.0000), -- Gomitas Creatina (20 reservadas)
(15, 15, 1, 7, 'PT-2026-003', '2026-10-31',  40.0000,   0.0000), -- Gomitas Colágeno
(16, 16, 1, 7, 'PT-2026-004', '2027-03-31',  25.0000,   0.0000), -- Mix Bienestar
-- Cuarentena (lote pendiente de aprobación QA)
(17, 1,  2, 8, 'L-2026-099', '2028-02-28',  80.0000,   0.0000), -- Gelatina en cuarentena
(18, 7,  2, 9, 'L-2026-098', NULL,          500.0000,   0.0000), -- Botellas rechazadas calidad
-- Lote VENCIDO para probar alertas
(19, 13, 1, 7, 'PT-2025-OLD', '2025-12-31',  5.0000,   0.0000), -- Gomitas VitC VENCIDAS
-- Lote crítico (vence en menos de 15 días)
(20, 15, 1, 7, 'PT-2026-CRIT', '2026-04-25', 12.0000,  0.0000); -- Colágeno CRITICO

-- ============================================================
-- 8. RECEPCIONES — Historial completo con diferentes estados
-- ============================================================
INSERT IGNORE INTO recepciones (id, numero, tercero_id, proveedor_nombre, bodega_id, estado, usuario_id, observaciones, moneda, costo_total, creado_en, completado_en) VALUES
-- REC-001: Completada en enero (materias primas iniciales)
(1, 'REC-2026-001', 1, 'Ingredientes Naturales SAS', 1, 'completada', 2,
   'Pedido inicial temporada. Gelatina + azúcar + ácido cítrico.',
   'COP', 57800000.00, '2026-01-08 08:00:00', '2026-01-08 11:30:00'),
-- REC-002: Completada en enero (vitaminas y activos)
(2, 'REC-2026-002', 1, 'Ingredientes Naturales SAS', 1, 'completada', 2,
   'Activos nutricionales: Vitamina C + Creatina + Colágeno.',
   'COP', 12260000.00, '2026-01-15 09:00:00', '2026-01-15 12:00:00'),
-- REC-003: Completada en febrero (empaques)
(3, 'REC-2026-003', 2, 'Empaques del Valle SAS',    1, 'completada', 4,
   'Empaques primer trimestre: botellas, doypacks, etiquetas.',
   'COP',  5380000.00, '2026-02-03 08:30:00', '2026-02-03 10:00:00'),
-- REC-004: En proceso (cuarentena — pendiente QA)
(4, 'REC-2026-004', 1, 'Ingredientes Naturales SAS', 2, 'en_proceso', 2,
   'Lote cuarentena. Inspector detectó humedad inusual. Pendiente análisis microbiológico.',
   'COP',  6640000.00, '2026-04-10 07:00:00', NULL),
-- REC-005: Borrador (orden de compra recibida, no descargada aún)
(5, 'REC-2026-005', 2, 'Empaques del Valle SAS',    1, 'borrador', 3,
   'OC #EV-2026-042. Botellas 500ml + doypacks para Q2.',
   'COP', NULL, '2026-04-14 09:00:00', NULL),
-- REC-006: Completada — lote con botellas rechazadas (qty_rec < qty_esp)
(6, 'REC-2026-006', 2, 'Empaques del Valle SAS',    2, 'completada', 4,
   'Lote botellas. 500 uds en cuarentena por defecto de fabricación. Reclamación abierta.',
   'COP',  1690000.00, '2026-03-05 08:00:00', '2026-03-05 09:30:00');

INSERT IGNORE INTO recepcion_items (recepcion_id, producto_id, ubicacion_id, lote, fecha_venc, cantidad_esp, cantidad_rec, precio_unitario, descuento) VALUES
-- REC-001
(1, 1, 1, 'L-2026-001', '2028-01-31', 320.0000, 320.0000, 83000.000000, 0.00),
(1, 2, 1, 'L-2026-002', '2028-06-30', 600.0000, 600.0000, 31500.000000, 0.00),
(1, 3, 2, 'L-2026-003', '2027-09-30',  50.0000,  48.0000, 47000.000000, 2.00),
-- REC-002
(2, 4, 2, 'L-2026-004', '2027-12-31',  20.0000,  18.0000, 315000.000000, 0.00),
(2, 5, 3, 'L-2026-005', '2027-11-30',  10.0000,   8.5000, 178000.000000, 0.00),
(2, 6, 3, 'L-2026-006', '2027-10-31',   5.0000,   3.0000, 208000.000000, 0.00),
-- REC-003
(3, 7, 4, 'L-2026-007', NULL,          3000.0000, 2800.0000, 360.000000, 5.00),
(3, 8, 4, 'L-2026-008', NULL,          1500.0000, 1500.0000, 272.000000, 3.00),
(3, 9, 5, 'L-2026-009', NULL,           900.0000,  850.0000, 435.000000, 0.00),
(3,10, 5, 'L-2026-010', NULL,           500.0000,  420.0000, 1750.000000,0.00),
-- REC-004 (cuarentena)
(4, 1, 8, 'L-2026-099', '2028-02-28',   80.0000,  80.0000, 83000.000000, 0.00),
-- REC-005 (borrador — sin cantidades recibidas aún)
(5, 7, NULL, NULL, NULL, 2000.0000, 0.0000, 360.000000, 5.00),
(5, 9, NULL, NULL, NULL,  500.0000, 0.0000, 435.000000, 0.00),
-- REC-006 (botellas rechazadas parcialmente)
(6, 7, 9, 'L-2026-098', NULL,          1000.0000,  500.0000, 360.000000, 0.00);

-- ============================================================
-- 9. DESPACHOS — Varios estados del flujo
-- ============================================================
INSERT IGNORE INTO despachos (id, numero, tercero_id, cliente_nombre, bodega_id, estado, usuario_id, observaciones, moneda, total_factura, creado_en, despachado_en) VALUES
(1, 'DSP-2026-001', 4, 'GymPro Colombia SAS',    1, 'despachado', 2,
   'Pedido urgente. Entrega en sede GymPro Cali.',
   'COP', 2170000.00, '2026-01-20 10:00:00', '2026-01-20 15:30:00'),
(2, 'DSP-2026-002', 5, 'Farmatodo Colombia SA',  1, 'despachado', 4,
   'Entrega a CEDI Farmatodo Bogotá. Factura FV-001-0458.',
   'COP', 4650000.00, '2026-02-10 09:00:00', '2026-02-10 14:00:00'),
(3, 'DSP-2026-003', 4, 'GymPro Colombia SAS',    1, 'picking', 2,
   'Pedido mensual GymPro. Asignando lotes FIFO.',
   'COP', NULL, '2026-03-15 08:00:00', NULL),
(4, 'DSP-2026-004', 7, 'Suplementos Online SAS', 1, 'empaque', 3,
   'Despacho e-commerce. 3 referencias. Empaque individual.',
   'COP', NULL, '2026-04-13 08:30:00', NULL),
(5, 'DSP-2026-005', 5, 'Farmatodo Colombia SA',  1, 'borrador', 2,
   'GRAN pedido Q2 Farmatodo. Requiere aprobación Laura por monto >$5M.',
   'COP', NULL, '2026-04-14 10:00:00', NULL),
(6, 'DSP-2026-006', 6, 'Juan Pérez Distribuciones', 1, 'anulado', 3,
   'Cliente canceló por problemas de pago. Stock liberado.',
   'COP', NULL, '2026-03-25 11:00:00', NULL);

INSERT IGNORE INTO despacho_items (despacho_id, producto_id, ubicacion_id, lote, cantidad_sol, cantidad_des, precio_unitario, descuento) VALUES
(1, 13, 7, 'PT-2026-001', 100.0000, 100.0000, 15500.000000, 5.00),
(1, 14, 7, 'PT-2026-002',  30.0000,  30.0000, 22000.000000, 5.00),
(2, 13, 7, 'PT-2026-001', 200.0000, 200.0000, 15500.000000, 10.00),
(2, 15, 7, 'PT-2026-003',  50.0000,  50.0000, 19000.000000,  8.00),
(3, 13, 7, 'PT-2026-001',  30.0000,   0.0000, 15500.000000, 5.00),
(3, 14, 7, 'PT-2026-002',  20.0000,   0.0000, 22000.000000, 5.00),
(3, 16, 7, 'PT-2026-004',  10.0000,   0.0000, 38000.000000, 3.00),
(4, 13, 7, 'PT-2026-001',  10.0000,   0.0000, 15500.000000, 0.00),
(4, 15, 7, 'PT-2026-CRIT', 12.0000,   0.0000, 19000.000000, 0.00),
(4, 16, 7, 'PT-2026-004',   5.0000,   0.0000, 38000.000000, 0.00),
(5, 13, 7, 'PT-2026-001', 100.0000,   0.0000, 14000.000000, 15.00),
(5, 14, 7, 'PT-2026-002',  60.0000,   0.0000, 20000.000000, 12.00),
(5, 15, 7, 'PT-2026-003',  80.0000,   0.0000, 17000.000000, 10.00),
(5, 16, 7, 'PT-2026-004',  30.0000,   0.0000, 35000.000000,  8.00),
(6, 13, 7, 'PT-2026-001',  20.0000,   0.0000, 15500.000000, 0.00);

-- ============================================================
-- 10. MOVIMIENTOS — Kardex completo enero–abril 2026
-- ============================================================
INSERT IGNORE INTO movimientos (id, tipo, producto_id, bodega_orig, bodega_dest, ubicacion_orig, ubicacion_dest, lote, cantidad, referencia_id, referencia_tipo, usuario_id, siigo_sync, creado_en) VALUES
(1,  'entrada', 1, NULL, 1, NULL, 1, 'L-2026-001', 320.0000,  1, 'recepcion', 2, 1, '2026-01-08 11:00:00'),
(2,  'entrada', 2, NULL, 1, NULL, 1, 'L-2026-002', 600.0000,  1, 'recepcion', 2, 1, '2026-01-08 11:05:00'),
(3,  'entrada', 3, NULL, 1, NULL, 2, 'L-2026-003',  48.0000,  1, 'recepcion', 2, 1, '2026-01-08 11:10:00'),
(4,  'entrada', 4, NULL, 1, NULL, 2, 'L-2026-004',  18.0000,  2, 'recepcion', 2, 1, '2026-01-15 11:30:00'),
(5,  'entrada', 5, NULL, 1, NULL, 3, 'L-2026-005',   8.5000,  2, 'recepcion', 2, 1, '2026-01-15 11:35:00'),
(6,  'entrada', 6, NULL, 1, NULL, 3, 'L-2026-006',   3.0000,  2, 'recepcion', 2, 1, '2026-01-15 11:40:00'),
(7,  'entrada', 7, NULL, 1, NULL, 4, 'L-2026-007', 2800.0000, 3, 'recepcion', 4, 1, '2026-02-03 09:30:00'),
(8,  'entrada', 8, NULL, 1, NULL, 4, 'L-2026-008', 1500.0000, 3, 'recepcion', 4, 1, '2026-02-03 09:35:00'),
(9,  'entrada', 9, NULL, 1, NULL, 5, 'L-2026-009',  850.0000, 3, 'recepcion', 4, 1, '2026-02-03 09:40:00'),
(10, 'entrada',10, NULL, 1, NULL, 5, 'L-2026-010',  420.0000, 3, 'recepcion', 4, 1, '2026-02-03 09:45:00'),
(11, 'traslado', 1, 1, 4, 1, 11, 'L-2026-001',  15.0000, NULL, 'produccion', 2, 0, '2026-02-20 07:00:00'),
(12, 'traslado', 2, 1, 4, 1, 11, 'L-2026-002',  30.0000, NULL, 'produccion', 2, 0, '2026-02-20 07:05:00'),
(13, 'traslado', 4, 1, 4, 2, 11, 'L-2026-004',   2.0000, NULL, 'produccion', 2, 0, '2026-02-20 07:10:00'),
(14, 'entrada',13, NULL, 1, NULL, 7, 'PT-2026-001', 350.0000, NULL, 'produccion', 3, 0, '2026-02-25 16:00:00'),
(15, 'salida', 13, 1, NULL, 7, NULL, 'PT-2026-001', 100.0000, 1, 'despacho', 2, 1, '2026-01-20 15:00:00'),
(16, 'salida', 14, 1, NULL, 7, NULL, 'PT-2026-002',  30.0000, 1, 'despacho', 2, 1, '2026-01-20 15:05:00'),
(17, 'salida', 13, 1, NULL, 7, NULL, 'PT-2026-001', 200.0000, 2, 'despacho', 4, 1, '2026-02-10 13:30:00'),
(18, 'salida', 15, 1, NULL, 7, NULL, 'PT-2026-003',  50.0000, 2, 'despacho', 4, 1, '2026-02-10 13:35:00'),
(19, 'ajuste',  7, 1, 1, 4, 4, 'L-2026-007', -200.0000, NULL, 'ajuste', 3, 0, '2026-03-31 17:00:00'),
(20, 'entrada',14, NULL, 1, NULL, 7, 'PT-2026-002',  95.0000, NULL, 'produccion', 3, 0, '2026-03-10 15:00:00'),
(21, 'entrada',15, NULL, 1, NULL, 7, 'PT-2026-003',  90.0000, NULL, 'produccion', 3, 0, '2026-03-20 15:00:00'),
(22, 'entrada',16, NULL, 1, NULL, 7, 'PT-2026-004',  25.0000, NULL, 'produccion', 3, 0, '2026-04-05 15:00:00'),
(23, 'ajuste',  1, 1, NULL, 1, NULL,'L-2026-001',  -2.0000, NULL, 'merma', 2, 0, '2026-03-05 10:00:00'),
(24, 'entrada', 1, NULL, 2, NULL, 8, 'L-2026-099',  80.0000, 4, 'recepcion', 2, 0, '2026-04-10 08:00:00'),
(25, 'traslado', 7, 2, 3, 9, 10, 'L-2026-098', 500.0000, 6, 'devolucion', 3, 0, '2026-03-10 11:00:00'),
(26, 'entrada',15, NULL, 1, NULL, 7, 'PT-2026-CRIT', 12.0000, NULL, 'produccion', 3, 0, '2026-04-01 08:00:00'),
(27, 'entrada',13, NULL, 1, NULL, 7, 'PT-2025-OLD',   5.0000, NULL, 'ajuste', 1, 0, '2025-12-01 08:00:00');

-- ============================================================
-- 11. WEBHOOK LOGS — Todos los escenarios del bot
-- ============================================================
INSERT IGNORE INTO webhook_logs (id, from_phone, action, priority, payload, response, status, created_at) VALUES
(1,  '573001234567', 'CONSULTAR_STOCK_MATERIA_PRIMA',    'baja',
 '{"kw":"g0ms","action":"CONSULTAR_STOCK_MATERIA_PRIMA","params":{"id_item":"RM-GEL-25K"}}',
 '{"ok":true,"message":"Gelatina 25kg — Disponible: 320 kg. Lote: L-2026-001 Venc: 2028-01-31"}',
 'PROCESSED', '2026-04-14 07:00:00'),
(2,  '573001234567', 'CONSULTAR_STOCK_PRODUCTO_TERMINADO','baja',
 '{"kw":"g0ms","action":"CONSULTAR_STOCK_PRODUCTO_TERMINADO","params":{"id_item":"PT-VITC-30"}}',
 '{"ok":true,"message":"Gomitas VitC x30 — Disponible: 150 uds. Reservadas: 30. Neto: 120 uds"}',
 'PROCESSED', '2026-04-14 07:05:00'),
(3,  '573001234567', 'SOLICITAR_INICIO_PRODUCCION',       'alta',
 '{"kw":"g0ms","action":"SOLICITAR_INICIO_PRODUCCION","params":{"id_producto_final":"PT-VITC-30","cantidad_deseada":200}}',
 '{"ok":true,"message":"Solicitud ORD-2026-PEND registrada. Pendiente aprobación supervisor Laura."}',
 'PROCESSED', '2026-04-14 08:00:00'),
(4,  '573009876543', 'CONSULTAR_CAPACIDAD_FABRICACION',  'baja',
 '{"kw":"g0ms","action":"CONSULTAR_CAPACIDAD_FABRICACION","params":{"id_producto_final":"PT-CREA-10","cantidad_deseada":50}}',
 '{"ok":false,"message":"Stock insuficiente: RM-CREA-1K disponible 8.5kg pero se requieren 12.5kg para 50 uds."}',
 'PROCESSED', '2026-04-14 08:15:00'),
(5,  '573009876543', 'SOLICITAR_DESPACHO',                'alta',
 '{"kw":"g0ms","action":"SOLICITAR_DESPACHO","params":{"id_lote":"PT-2026-002","cantidad":20,"cliente_destino":"GymPro"}}',
 '{"ok":true,"message":"Despacho DSP-2026-003 actualizado. 20 uds PT-CREA-10 asignadas a GymPro."}',
 'PROCESSED', '2026-04-14 09:00:00'),
(6,  '573001112222', 'INGRESO_RECEPCION',                 'media',
 '{"kw":"g0ms","action":"INGRESO_RECEPCION","params":{"id_item":"RM-GEL-25K","qty_buenas":80,"id_proveedor":"900123456"}}',
 '{"ok":false,"error":"Proveedor bloqueado temporalmente: lote L-2026-099 en cuarentena activa."}',
 'REJECTED', '2026-04-10 07:50:00'),
(7,  '573001234567', 'REPORTE_MERMA',                     'media',
 '{"kw":"g0ms","action":"REPORTE_MERMA","params":{"id_item":"RM-GEL-25K","id_lote":"L-2026-001","cantidad":2,"motivo":"contaminacion_cruzada"}}',
 '{"ok":true,"message":"Merma registrada: 2 kg RM-GEL-25K lote L-2026-001. Pendiente aprobación."}',
 'PROCESSED', '2026-03-05 10:10:00'),
(8,  '573001234567', 'CONSULTAR_ESTADO_PRODUCCION',       'baja',
 '{"kw":"g0ms","action":"CONSULTAR_ESTADO_PRODUCCION","params":{"id_orden":"PT-2026-001"}}',
 '{"ok":true,"message":"Lote PT-2026-001 — Estado: DISPONIBLE. Stock: 150 uds. Bodega Principal."}',
 'PROCESSED', '2026-04-14 09:30:00'),
(9,  '573001112222', 'CONSULTAR_TRAZABILIDAD_LOTE',       'baja',
 '{"kw":"g0ms","action":"CONSULTAR_TRAZABILIDAD_LOTE","params":{"id_lote":"L-2026-099"}}',
 '{"ok":true,"message":"L-2026-099 RM-GEL-25K. Ingresó 2026-04-10. Estado: CUARENTENA BG-CUAR."}',
 'PROCESSED', '2026-04-14 09:45:00'),
(10, '573005550000', 'DESCONOCIDA',                       'baja',
 '{"kw":"hola","action":"stock","params":{}}',
 '{"ok":false,"error":"Acceso denegado. Keyword inválida."}',
 'REJECTED', '2026-04-14 10:00:00'),
(11, '573009876543', 'GESTION_DEVOLUCION',                'media',
 '{"kw":"g0ms","action":"GESTION_DEVOLUCION","params":{"id_item":"EM-BOT-500","cantidad":500,"estado":"DESTRUCCION"}}',
 '{"ok":true,"message":"Devolución registrada: 500 uds EM-BOT-500. Estado: DESTRUCCION."}',
 'PROCESSED', '2026-03-10 11:30:00'),
(12, '573001234567', 'CONSULTAR_STOCK_MATERIA_PRIMA',     'baja',
 '{"kw":"g0ms","action":"CONSULTAR_STOCK_MATERIA_PRIMA","params":{"id_item":"RM-XXX-999"}}',
 '{"ok":false,"error":"Producto RM-XXX-999 no encontrado en el sistema."}',
 'ERROR', '2026-04-14 10:30:00');

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT tabla, registros FROM (
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
  UNION ALL SELECT 'webhook_logs',    COUNT(*) FROM webhook_logs
) AS resumen;
