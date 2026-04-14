-- =============================================================
-- WMS — SEED DE DATOS DE PRUEBA
-- Ejecutar en phpMyAdmin o MySQL CLI: source seed_demo.sql
-- Todos los UUIDs son fijos para que las relaciones sean estables
-- =============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';

-- -------------------------------------------------------------
-- 0. ROLES (prerequisito)
-- -------------------------------------------------------------
INSERT IGNORE INTO roles (id, name, permissions, createdAt, updatedAt) VALUES
  ('11111111-0000-0000-0000-000000000001', 'admin',    '{"all":true}',                          NOW(), NOW()),
  ('11111111-0000-0000-0000-000000000002', 'operario', '{"reception":true,"dispatch":true}',    NOW(), NOW()),
  ('11111111-0000-0000-0000-000000000003', 'supervisor','{}',                                   NOW(), NOW());

-- -------------------------------------------------------------
-- 1. USUARIOS
-- pw: Test1234! → bcrypt hash (copiado de bcrypt.hashSync)
-- -------------------------------------------------------------
INSERT IGNORE INTO users (id, name, phone, email, password_hash, role_id, active, createdAt, updatedAt) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Admin WMS',      '+573001000001', 'admin@wms.co',      '$2b$10$wVJiO9X3ZszFzl1VQ8ePlONFa3N9xBhxeXfN3Gb1p7sKe7FoiUlPa', '11111111-0000-0000-0000-000000000001', 1, NOW(), NOW()),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Carlos Bodega',  '+573002000002', 'carlos@wms.co',     '$2b$10$wVJiO9X3ZszFzl1VQ8ePlONFa3N9xBhxeXfN3Gb1p7sKe7FoiUlPa', '11111111-0000-0000-0000-000000000002', 1, NOW(), NOW()),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Laura Sup',      '+573003000003', 'laura@wms.co',      '$2b$10$wVJiO9X3ZszFzl1VQ8ePlONFa3N9xBhxeXfN3Gb1p7sKe7FoiUlPa', '11111111-0000-0000-0000-000000000003', 1, NOW(), NOW()),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Bot BuilderBot', '+573004000099', NULL,                NULL,                                                            '11111111-0000-0000-0000-000000000002', 1, NOW(), NOW());

-- -------------------------------------------------------------
-- 2. PRODUCTOS (6 — mix de tipos)
-- -------------------------------------------------------------
INSERT IGNORE INTO products (id, sku, name, description, type, unit, min_stock, max_stock, siigo_active, active, createdAt, updatedAt) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'RM-TAP-MED',  'Tapa mediana PET',            'Tapa roscada 28mm para botella 500ml', 'MATERIA_PRIMA',     'und', 500,  5000, 0, 1, NOW(), NOW()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'RM-BOT-500',  'Botella PET 500ml',           'Botella transparente 500ml sin tapa',  'MATERIA_PRIMA',     'und', 300,  3000, 0, 1, NOW(), NOW()),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'PT-AGU-500',  'Agua purificada 500ml',       'Producto terminado envasado',          'PRODUCTO_TERMINADO','und', 200,  8000, 0, 1, NOW(), NOW()),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'IN-ETI-A4',   'Etiqueta autoadhesiva A4',    'Rollo de etiquetas 100x50mm',          'INSUMO',            'und', 1000, 10000,0, 1, NOW(), NOW()),
  ('bbbbbbbb-0000-0000-0000-000000000005', 'EM-CAJ-MED',  'Caja carton mediana',         'Caja 30x20x15cm canale simple',        'EMPAQUE',           'und', 100,  2000, 0, 1, NOW(), NOW()),
  ('bbbbbbbb-0000-0000-0000-000000000006', 'RM-FIL-CAR',  'Filtro de carbon activado',   'Filtro granular 1kg para purificador', 'MATERIA_PRIMA',     'kg',  50,   500,  0, 1, NOW(), NOW());

-- -------------------------------------------------------------
-- 3. LOTES (8 lotes — varios estados)
-- -------------------------------------------------------------
INSERT IGNORE INTO lots (id, lpn, product_id, qty_initial, qty_current, supplier, origin, status, expiry_date, received_by, notes, createdAt, updatedAt) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'L-2026-001', 'bbbbbbbb-0000-0000-0000-000000000001', 2000, 1850, 'Plasticos SAS',     'RECEPCION',  'DISPONIBLE',   '2027-06-01', 'aaaaaaaa-0000-0000-0000-000000000002', 'Lote principal tapas',       NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000002', 'L-2026-002', 'bbbbbbbb-0000-0000-0000-000000000001', 1000,  120, 'Plasticos SAS',     'RECEPCION',  'DISPONIBLE',   '2027-06-01', 'aaaaaaaa-0000-0000-0000-000000000002', 'Lote secundario tapas',      NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000003', 'L-2026-003', 'bbbbbbbb-0000-0000-0000-000000000002', 3000, 2750, 'Envases Ltda',      'RECEPCION',  'DISPONIBLE',   '2028-01-01', 'aaaaaaaa-0000-0000-0000-000000000002', 'Botellas 500ml',             NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000004', 'L-2026-004', 'bbbbbbbb-0000-0000-0000-000000000003', 5000, 4200, NULL,                'PRODUCCION', 'DISPONIBLE',   NULL,         'aaaaaaaa-0000-0000-0000-000000000001', 'Agua produccion ene-2026',   NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000005', 'L-2026-005', 'bbbbbbbb-0000-0000-0000-000000000004', 8000, 7500, 'Sumin. Oficina',    'RECEPCION',  'DISPONIBLE',   '2028-12-31', 'aaaaaaaa-0000-0000-0000-000000000002', 'Etiquetas autoadhesivas',    NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000006', 'L-2026-006', 'bbbbbbbb-0000-0000-0000-000000000005',  500,  490, 'Carton Express',    'RECEPCION',  'DISPONIBLE',   NULL,         'aaaaaaaa-0000-0000-0000-000000000002', 'Cajas despacho',             NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000007', 'L-2025-099', 'bbbbbbbb-0000-0000-0000-000000000006',  200,  200, 'Filtros Colombia',  'RECEPCION',  'CUARENTENA',   '2026-12-31', 'aaaaaaaa-0000-0000-0000-000000000002', 'Pendiente analisis calidad', NOW(), NOW()),
  ('cccccccc-0000-0000-0000-000000000008', 'L-2025-050', 'bbbbbbbb-0000-0000-0000-000000000002', 1000,    0, 'Envases Ltda',      'RECEPCION',  'AGOTADO',      '2027-01-01', 'aaaaaaaa-0000-0000-0000-000000000002', 'Lote agotado historico',     NOW(), NOW());

-- -------------------------------------------------------------
-- 4. ORDENES DE PRODUCCION (3)
-- -------------------------------------------------------------
INSERT IGNORE INTO production_orders (id, product_id, qty_planned, qty_real, current_phase, status, started_by, notes, createdAt, updatedAt) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', 5000, NULL,  'F3', 'IN_PROGRESS', 'aaaaaaaa-0000-0000-0000-000000000001', 'Produccion semana 15', NOW(), NOW()),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 3000, 2980,  'F5', 'CLOSED',      'aaaaaaaa-0000-0000-0000-000000000001', 'Produccion semana 14', NOW(), NOW()),
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000003', 6000, NULL,  'F1', 'PENDING',     'aaaaaaaa-0000-0000-0000-000000000003', 'Produccion semana 16', NOW(), NOW());

-- -------------------------------------------------------------
-- 5. KARDEX (16 movimientos realistas)
-- -------------------------------------------------------------
INSERT IGNORE INTO kardex (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after, reference, notes, createdAt, updatedAt) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'TX-20260101-001', 'cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'INGRESO_RECEPCION',   2000, 2000, 'REC-001', 'Ingreso inicial tapas',              '2026-01-05 08:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000002', 'TX-20260101-002', 'cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'INGRESO_RECEPCION',   1000, 3000, 'REC-002', 'Segundo lote tapas',                 '2026-01-08 09:15:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000003', 'TX-20260101-003', 'cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'INGRESO_RECEPCION',   3000, 3000, 'REC-003', 'Botellas 500ml',                     '2026-01-10 10:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000004', 'TX-20260115-001', 'cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'CONSUMO_MATERIAL',     150, 2850, 'PROD-001','Consumo produccion semana 14',       '2026-01-15 07:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000005', 'TX-20260115-002', 'cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'CONSUMO_MATERIAL',     250, 2750, 'PROD-001','Botellas consumidas semana 14',      '2026-01-15 07:05:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000006', 'TX-20260115-003', 'cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'CIERRE_PRODUCCION',   2980, 2980, 'PROD-002','Cierre orden semana 14',             '2026-01-20 18:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000007', 'TX-20260120-001', 'cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'DESPACHO',             800, 4200, 'DES-001', 'Despacho cliente Supermercados XYZ', '2026-01-22 14:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000008', 'TX-20260122-001', 'cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'DESPACHO',            1000, 3200, 'DES-002', 'Despacho cliente Tienda Verde',      '2026-01-25 10:30:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000009', 'TX-20260201-001', 'cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'MERMA_BODEGA',          20, 2830, 'MRM-001', 'Tapas danadas por humedad',          '2026-02-01 11:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000010', 'TX-20260205-001', 'cccccccc-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'INGRESO_RECEPCION',   8000, 8000, 'REC-004', 'Etiquetas autoadhesivas',            '2026-02-05 09:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000011', 'TX-20260205-002', 'cccccccc-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000002', 'INGRESO_RECEPCION',    500,  500, 'REC-005', 'Cajas de carton medianas',           '2026-02-05 09:30:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000012', 'TX-20260210-001', 'cccccccc-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'CONSUMO_MATERIAL',     500, 7500, 'PROD-003','Etiquetas para produccion s15',      '2026-02-10 08:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000013', 'TX-20260210-002', 'cccccccc-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000002', 'CONSUMO_MATERIAL',      10,  490, 'PROD-003','Cajas despacho semana 15',           '2026-02-10 08:05:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000014', 'TX-20260301-001', 'cccccccc-0000-0000-0000-000000000007', 'bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 'INGRESO_NOVEDAD',      200,  200, 'REC-006', 'Filtros en cuarentena analisis',     '2026-03-01 10:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000015', 'TX-20260310-001', 'cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'INGRESO_RECEPCION',   1000, 4000, 'REC-007', 'Reposicion tapas stock bajo',        '2026-03-10 09:00:00', NOW()),
  ('eeeeeeee-0000-0000-0000-000000000016', 'TX-20260401-001', 'cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'MERMA_PROCESO',         30, 2720, 'MRM-002', 'Botellas rotas durante produccion',  '2026-04-01 07:30:00', NOW());

-- -------------------------------------------------------------
-- 6. WASTE RECORDS (4 mermas)
-- -------------------------------------------------------------
INSERT IGNORE INTO waste_records (id, type, product_id, lot_id, production_order_id, qty, reason, approved_by, createdAt, updatedAt) VALUES
  ('ffffffff-0000-0000-0000-000000000001', 'MERMA_EN_ESTANTERIA',  'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', NULL,                                    20,  'Tapas danadas por humedad en bodega',     'aaaaaaaa-0000-0000-0000-000000000001', '2026-02-01 11:00:00', NOW()),
  ('ffffffff-0000-0000-0000-000000000002', 'MERMA_EN_MAQUINA',     'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000002',  30,  'Botellas rotas en llenadora',             'aaaaaaaa-0000-0000-0000-000000000001', '2026-04-01 07:30:00', NOW()),
  ('ffffffff-0000-0000-0000-000000000003', 'RECHAZO_PROVEEDOR',    'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', NULL,                                     5,  'Tapas con defecto de molde proveedor',    NULL,                                   '2026-04-05 10:00:00', NOW()),
  ('ffffffff-0000-0000-0000-000000000004', 'AJUSTE_MANUAL',        'bbbbbbbb-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000005', NULL,                                    50,  'Ajuste inventario etiquetas danadas',     'aaaaaaaa-0000-0000-0000-000000000001', '2026-04-10 16:00:00', NOW());

-- -------------------------------------------------------------
-- 7. APROBACIONES PENDIENTES (5 — variados)
-- -------------------------------------------------------------
INSERT IGNORE INTO approval_queue (id, request_code, action, payload, requested_by, status, expires_at, createdAt, updatedAt) VALUES
  ('99999999-0000-0000-0000-000000000001', 'REQ-2026-001', 'SOLICITAR_INICIO_PRODUCCION',
    '{"product_id":"bbbbbbbb-0000-0000-0000-000000000003","qty_planned":6000,"notes":"Semana 16"}',
    'aaaaaaaa-0000-0000-0000-000000000004', 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW()),
  ('99999999-0000-0000-0000-000000000002', 'REQ-2026-002', 'REPORTAR_MERMA',
    '{"type":"MERMA_EN_MAQUINA","product_id":"bbbbbbbb-0000-0000-0000-000000000002","qty":15,"lot_id":"cccccccc-0000-0000-0000-000000000003"}',
    'aaaaaaaa-0000-0000-0000-000000000004', 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW()),
  ('99999999-0000-0000-0000-000000000003', 'REQ-2026-003', 'SOLICITAR_DESPACHO',
    '{"lot_id":"cccccccc-0000-0000-0000-000000000004","qty":500,"customer":"Tienda Natural SAS","siigo_order_id":"OV-2026-031"}',
    'aaaaaaaa-0000-0000-0000-000000000002', 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 12 HOUR), NOW(), NOW()),
  ('99999999-0000-0000-0000-000000000004', 'REQ-2026-004', 'SOLICITAR_CIERRE_PRODUCCION',
    '{"order_id":"dddddddd-0000-0000-0000-000000000001","qty_real":4850}',
    'aaaaaaaa-0000-0000-0000-000000000004', 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 6 HOUR),  NOW(), NOW()),
  ('99999999-0000-0000-0000-000000000005', 'REQ-2026-005', 'GESTION_DEVOLUCION',
    '{"product_id":"bbbbbbbb-0000-0000-0000-000000000003","qty":24,"customer":"Supermercados XYZ","reason":"Producto vencido"}',
    'aaaaaaaa-0000-0000-0000-000000000004', 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 48 HOUR), NOW(), NOW());

-- -------------------------------------------------------------
-- 8. WEBHOOK LOGS (6 mensajes BuilderBot simulados)
-- -------------------------------------------------------------
INSERT IGNORE INTO webhook_logs (id, from_phone, action, priority, payload, response, status, created_at) VALUES
  (1, '+573004000099', 'CONSULTAR_STOCK',              'baja',
   '{"keyword":"g0ms","action":"CONSULTAR_STOCK","sku":"RM-TAP-MED"}',
   '{"ok":true,"disponible_neto":1970,"comprometido":0,"lotes_activos":2}',
   'PROCESSED', '2026-04-14 08:05:00'),
  (2, '+573004000099', 'SOLICITAR_INICIO_PRODUCCION',  'alta',
   '{"keyword":"g0ms","action":"SOLICITAR_INICIO_PRODUCCION","product_id":"bbbbbbbb-0000-0000-0000-000000000003","qty_planned":6000}',
   '{"ok":true,"request_code":"REQ-2026-001","message":"Solicitud creada y pendiente de aprobacion"}',
   'PROCESSED', '2026-04-14 08:10:00'),
  (3, '+573004000099', 'REPORTAR_MERMA',               'alta',
   '{"keyword":"g0ms","action":"REPORTAR_MERMA","type":"MERMA_EN_MAQUINA","sku":"RM-BOT-500","qty":15,"lpn":"L-2026-003"}',
   '{"ok":true,"request_code":"REQ-2026-002","message":"Merma reportada pendiente aprobacion supervisor"}',
   'PROCESSED', '2026-04-14 09:22:00'),
  (4, '+573004000099', 'CONSULTAR_LOTE',               'baja',
   '{"keyword":"g0ms","action":"CONSULTAR_LOTE","lpn":"L-2025-099"}',
   '{"ok":true,"lpn":"L-2025-099","status":"CUARENTENA","qty_current":200,"product":"Filtro de carbon activado"}',
   'PROCESSED', '2026-04-14 10:01:00'),
  (5, '+573004000099', 'SOLICITAR_DESPACHO',           'media',
   '{"keyword":"g0ms","action":"SOLICITAR_DESPACHO","lpn":"L-2026-004","qty":500,"customer":"Tienda Natural SAS"}',
   '{"ok":true,"request_code":"REQ-2026-003","message":"Despacho pendiente de aprobacion"}',
   'PROCESSED', '2026-04-14 11:45:00'),
  (6, '+573004000099', 'CONSULTAR_STOCK',              'baja',
   '{"keyword":"g0ms","action":"CONSULTAR_STOCK","sku":"RM-FIL-CAR"}',
   '{"ok":false,"message":"Producto RM-FIL-CAR en cuarentena, no disponible"}',
   'REJECTED', '2026-04-14 12:30:00');

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- RESUMEN DE IDs IMPORTANTES PARA PRUEBAS
-- =============================================================
-- USUARIOS
--   admin:    aaaaaaaa-0000-0000-0000-000000000001  /  admin@wms.co  / Test1234!
--   operario: aaaaaaaa-0000-0000-0000-000000000002  /  carlos@wms.co / Test1234!
--   bot:      aaaaaaaa-0000-0000-0000-000000000004  /  +573004000099
--
-- PRODUCTOS
--   RM-TAP-MED  bbbbbbbb-0000-0000-0000-000000000001  (tapas)
--   RM-BOT-500  bbbbbbbb-0000-0000-0000-000000000002  (botellas) ← stock BAJO
--   PT-AGU-500  bbbbbbbb-0000-0000-0000-000000000003  (agua terminada)
--   IN-ETI-A4   bbbbbbbb-0000-0000-0000-000000000004  (etiquetas)
--   EM-CAJ-MED  bbbbbbbb-0000-0000-0000-000000000005  (cajas)
--   RM-FIL-CAR  bbbbbbbb-0000-0000-0000-000000000006  (filtros) ← CUARENTENA
--
-- LOTES DISPONIBLES
--   L-2026-001  cccccccc-0000-0000-0000-000000000001  1850 tapas
--   L-2026-003  cccccccc-0000-0000-0000-000000000003  2750 botellas
--   L-2026-004  cccccccc-0000-0000-0000-000000000004  4200 agua terminada
--
-- ORDENES DE PRODUCCION
--   EN CURSO:  dddddddd-0000-0000-0000-000000000001  (fase F3)
--   CERRADA:   dddddddd-0000-0000-0000-000000000002
--   PENDIENTE: dddddddd-0000-0000-0000-000000000003
-- =============================================================
