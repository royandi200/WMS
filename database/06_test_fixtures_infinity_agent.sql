-- Fixtures de prueba para agente BuilderBot y dashboard usando catalogo real Infinity.
-- Fuente de productos reales: database/05_infinity_product_catalog.sql.
-- Todo lo creado aqui queda marcado con TEST_AGENT y puede limpiarse sin tocar catalogo real.

START TRANSACTION;

SET @bodega_ppal := (SELECT id FROM bodegas WHERE codigo = 'BG-PPAL' LIMIT 1);
SET @bodega_cuar := (SELECT id FROM bodegas WHERE codigo = 'BG-CUAR' LIMIT 1);
SET @ubic_ppal_a1 := (SELECT id FROM ubicaciones WHERE bodega_id = @bodega_ppal AND activa = 1 ORDER BY id LIMIT 1);
SET @ubic_ppal_a2 := (SELECT id FROM ubicaciones WHERE bodega_id = @bodega_ppal AND activa = 1 ORDER BY id LIMIT 1 OFFSET 1);
SET @ubic_cuar := (SELECT id FROM ubicaciones WHERE bodega_id = @bodega_cuar AND activa = 1 ORDER BY id LIMIT 1);
SET @user_operario := (SELECT id FROM usuarios WHERE telefono = '573174442659' AND activo = 1 LIMIT 1);
SET @user_supervisor := (SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE LOWER(r.nombre) IN ('supervisor','admin') AND u.activo = 1 ORDER BY FIELD(LOWER(r.nombre), 'supervisor', 'admin'), u.id LIMIT 1);

SET @pt_ash := (SELECT id FROM productos WHERE siigo_code = '00102-PTASH60' LIMIT 1);
SET @pt_cg := (SELECT id FROM productos WHERE siigo_code = '00110-PTCG120' LIMIT 1);
SET @mp_ash := (SELECT id FROM productos WHERE siigo_code = '00051-MPASH' LIMIT 1);
SET @mp_cg := (SELECT id FROM productos WHERE siigo_code = '00052-MPCG' LIMIT 1);
SET @tarro_grande := (SELECT id FROM productos WHERE siigo_code = '00007-TRG' LIMIT 1);
SET @tapa_ash := (SELECT id FROM productos WHERE siigo_code = '00004-TPALB' LIMIT 1);
SET @etiq_ash := (SELECT id FROM productos WHERE siigo_code = '00017-ETASH60' LIMIT 1);
SET @etiq_cg120 := (SELECT id FROM productos WHERE siigo_code = '00022-ETCG120' LIMIT 1);
SET @etiq_cg140 := (SELECT id FROM productos WHERE siigo_code = '00030-ETCG140' LIMIT 1);

-- Limpieza idempotente de escenarios anteriores.
DELETE FROM aprobaciones WHERE codigo_solicitud LIKE 'REQ-TEST-%' OR codigo_solicitud IN ('REQ-900001', 'REQ-900002');
DELETE FROM kardex WHERE reference LIKE 'TEST_AGENT:%' OR notes LIKE '%TEST_AGENT%';
DELETE FROM movimientos WHERE referencia_tipo = 'TEST_AGENT';
DELETE FROM despachos WHERE numero LIKE 'DSP-TEST-%';
DELETE FROM devoluciones WHERE numero LIKE 'DEV-TEST-%';
DELETE ri FROM recepcion_items ri JOIN recepciones r ON r.id = ri.recepcion_id WHERE r.numero LIKE 'REC-TEST-%';
DELETE FROM recepciones WHERE numero LIKE 'REC-TEST-%';
DELETE FROM stock WHERE lote LIKE 'TEST_AGENT-%';
DELETE FROM lots WHERE lpn LIKE 'TEST_AGENT-%';
DELETE FROM ordenes_produccion WHERE codigo_orden LIKE 'OP-TEST-%';
DELETE FROM bom WHERE notas LIKE 'TEST_AGENT%';

-- Minimos para probar Stock Bajo en dashboard.
UPDATE productos
SET stock_minimo = CASE siigo_code
  WHEN '00030-ETCG140' THEN 50
  WHEN '00022-ETCG120' THEN 80
  ELSE stock_minimo
END
WHERE siigo_code IN ('00030-ETCG140', '00022-ETCG120');

-- BOM temporal: valores inventados solo para pruebas funcionales.
INSERT INTO bom (producto_final_id, insumo_id, cantidad_por_unidad, unidad, notas) VALUES
(@pt_ash, @mp_ash,       1.0000, 'und', 'TEST_AGENT BOM Ashwagandha base x unidad'),
(@pt_ash, @tarro_grande, 1.0000, 'und', 'TEST_AGENT BOM Ashwagandha tarro x unidad'),
(@pt_ash, @tapa_ash,     1.0000, 'und', 'TEST_AGENT BOM Ashwagandha tapa x unidad'),
(@pt_ash, @etiq_ash,     1.0000, 'und', 'TEST_AGENT BOM Ashwagandha etiqueta x unidad'),
(@pt_cg,  @mp_cg,        1.0000, 'und', 'TEST_AGENT BOM Creagums base x unidad'),
(@pt_cg,  @tarro_grande, 1.0000, 'und', 'TEST_AGENT BOM Creagums tarro x unidad'),
(@pt_cg,  @tapa_ash,     1.0000, 'und', 'TEST_AGENT BOM Creagums tapa generica x unidad'),
(@pt_cg,  @etiq_cg120,   1.0000, 'und', 'TEST_AGENT BOM Creagums etiqueta x unidad');

-- Lotes y stock para probar FIFO, vencidos, cuarentena, stock bajo y despacho.
INSERT INTO lots
(id, lpn, product_id, bodega_id, qty_initial, qty_current, supplier, origin, status, expiry_date, received_by, notes, created_at, updated_at)
VALUES
('aaaaaaaa-0000-0000-0000-000000000001', 'TEST_AGENT-MPASH-FIFO-OLD', @mp_ash, @bodega_ppal, 500, 500, 'Proveedor TEST_AGENT', 'RECEPCION', 'DISPONIBLE', DATE_ADD(CURDATE(), INTERVAL 30 DAY), @user_operario, 'TEST_AGENT lote FIFO antiguo Ashwagandha', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000002', 'TEST_AGENT-MPASH-FIFO-NEW', @mp_ash, @bodega_ppal, 300, 300, 'Proveedor TEST_AGENT', 'RECEPCION', 'DISPONIBLE', DATE_ADD(CURDATE(), INTERVAL 90 DAY), @user_operario, 'TEST_AGENT lote FIFO nuevo Ashwagandha', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000003', 'TEST_AGENT-MPASH-EXPIRED', @mp_ash, @bodega_ppal, 25, 25, 'Proveedor TEST_AGENT', 'RECEPCION', 'DISPONIBLE', DATE_SUB(CURDATE(), INTERVAL 10 DAY), @user_operario, 'TEST_AGENT lote vencido para alertas', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000004', 'TEST_AGENT-MPCG-FIFO-OLD', @mp_cg, @bodega_ppal, 420, 420, 'Proveedor TEST_AGENT', 'RECEPCION', 'DISPONIBLE', DATE_ADD(CURDATE(), INTERVAL 45 DAY), @user_operario, 'TEST_AGENT lote FIFO Creagums', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000005', 'TEST_AGENT-MPCG-CUARENTENA', @mp_cg, @bodega_cuar, 30, 30, 'Proveedor TEST_AGENT', 'RECEPCION', 'CUARENTENA', DATE_ADD(CURDATE(), INTERVAL 60 DAY), @user_operario, 'TEST_AGENT lote cuarentena Creagums', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000006', 'TEST_AGENT-PTASH-DISP', @pt_ash, @bodega_ppal, 120, 120, 'Produccion TEST_AGENT', 'PRODUCCION', 'DISPONIBLE', DATE_ADD(CURDATE(), INTERVAL 180 DAY), @user_operario, 'TEST_AGENT producto terminado disponible', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000007', 'TEST_AGENT-PTCG-DISP', @pt_cg, @bodega_ppal, 80, 80, 'Produccion TEST_AGENT', 'PRODUCCION', 'DISPONIBLE', DATE_ADD(CURDATE(), INTERVAL 180 DAY), @user_operario, 'TEST_AGENT producto terminado disponible', NOW(), NOW()),
('aaaaaaaa-0000-0000-0000-000000000008', 'TEST_AGENT-ETCG140-LOW', @etiq_cg140, @bodega_ppal, 12, 12, 'Proveedor TEST_AGENT', 'RECEPCION', 'DISPONIBLE', NULL, @user_operario, 'TEST_AGENT stock bajo etiquetas', NOW(), NOW());

INSERT INTO stock (producto_id, bodega_id, ubicacion_id, lote, fecha_venc, cantidad, reservada, actualizado_en) VALUES
(@mp_ash, @bodega_ppal, @ubic_ppal_a1, 'TEST_AGENT-MPASH-FIFO-OLD', DATE_ADD(CURDATE(), INTERVAL 30 DAY), 500, 0, NOW()),
(@mp_ash, @bodega_ppal, @ubic_ppal_a2, 'TEST_AGENT-MPASH-FIFO-NEW', DATE_ADD(CURDATE(), INTERVAL 90 DAY), 300, 0, NOW()),
(@mp_ash, @bodega_ppal, @ubic_ppal_a1, 'TEST_AGENT-MPASH-EXPIRED', DATE_SUB(CURDATE(), INTERVAL 10 DAY), 25, 0, NOW()),
(@mp_cg, @bodega_ppal, @ubic_ppal_a1, 'TEST_AGENT-MPCG-FIFO-OLD', DATE_ADD(CURDATE(), INTERVAL 45 DAY), 420, 0, NOW()),
(@mp_cg, @bodega_cuar, @ubic_cuar, 'TEST_AGENT-MPCG-CUARENTENA', DATE_ADD(CURDATE(), INTERVAL 60 DAY), 30, 0, NOW()),
(@tarro_grande, @bodega_ppal, @ubic_ppal_a2, 'TEST_AGENT-TARRO-GRANDE', NULL, 900, 0, NOW()),
(@tapa_ash, @bodega_ppal, @ubic_ppal_a2, 'TEST_AGENT-TAPA-ASH', NULL, 900, 0, NOW()),
(@etiq_ash, @bodega_ppal, @ubic_ppal_a2, 'TEST_AGENT-ETASH60', NULL, 350, 0, NOW()),
(@etiq_cg120, @bodega_ppal, @ubic_ppal_a2, 'TEST_AGENT-ETCG120', NULL, 75, 0, NOW()),
(@etiq_cg140, @bodega_ppal, @ubic_ppal_a2, 'TEST_AGENT-ETCG140-LOW', NULL, 12, 0, NOW()),
(@pt_ash, @bodega_ppal, @ubic_ppal_a1, 'TEST_AGENT-PTASH-DISP', DATE_ADD(CURDATE(), INTERVAL 180 DAY), 120, 0, NOW()),
(@pt_cg, @bodega_ppal, @ubic_ppal_a1, 'TEST_AGENT-PTCG-DISP', DATE_ADD(CURDATE(), INTERVAL 180 DAY), 80, 0, NOW());

-- Recepcion, despacho y devolucion para pantallas y trazabilidad.
INSERT INTO recepciones (numero, proveedor_nombre, bodega_id, estado, usuario_id, observaciones, completado_en)
VALUES ('REC-TEST-AGENT-001', 'Proveedor TEST_AGENT', @bodega_ppal, 'completada', @user_operario, 'TEST_AGENT recepcion base para QA', NOW());
SET @recepcion_id := LAST_INSERT_ID();
INSERT INTO recepcion_items (recepcion_id, producto_id, ubicacion_id, lote, fecha_venc, cantidad_esp, cantidad_rec, precio_unitario)
VALUES
(@recepcion_id, @mp_ash, @ubic_ppal_a1, 'TEST_AGENT-MPASH-FIFO-OLD', DATE_ADD(CURDATE(), INTERVAL 30 DAY), 500, 500, 1),
(@recepcion_id, @mp_cg, @ubic_ppal_a1, 'TEST_AGENT-MPCG-FIFO-OLD', DATE_ADD(CURDATE(), INTERVAL 45 DAY), 420, 420, 1);

INSERT INTO despachos (numero, cliente_nombre, bodega_id, producto_id, lote, cantidad, estado, usuario_id, observaciones, despachado_en)
VALUES ('DSP-TEST-AGENT-001', 'Cliente TEST_AGENT', @bodega_ppal, @pt_ash, 'TEST_AGENT-PTASH-DISP', 10, 'despachado', @user_operario, 'TEST_AGENT despacho historico para dashboard', NOW());

INSERT INTO devoluciones (numero, producto_id, lote, cliente_origen, cantidad, estado, usuario_id, observaciones, creado_en)
VALUES ('DEV-TEST-AGENT-001', @pt_ash, 'TEST_AGENT-DEV-PTASH', 'Cliente TEST_AGENT', 5, 'CUARENTENA', @user_operario, 'TEST_AGENT devolucion dashboard', NOW());

-- Ordenes de produccion en estados clave.
INSERT INTO ordenes_produccion
(codigo_orden, producto_id, fase, estado, cantidad_planeada, cantidad_real, materiales_conf_en, cerrado_en, creado_por, aprobado_por, notas, creado_en)
VALUES
('OP-TEST-ASH-PLAN', @pt_ash, 'F0', 'PLANEADA', 100, 0, NULL, NULL, @user_operario, NULL, 'TEST_AGENT orden planeada para aprobar', NOW()),
('OP-TEST-CG-PROC', @pt_cg, 'F2', 'EN_PROCESO', 80, 0, NOW(), NULL, @user_operario, @user_supervisor, 'TEST_AGENT orden en proceso para avances/merma/cierre', NOW()),
('OP-TEST-ASH-CERR', @pt_ash, 'F5', 'CERRADA', 100, 96, NOW(), NOW(), @user_operario, @user_supervisor, 'TEST_AGENT orden cerrada para dashboard', NOW());

SET @op_plan := (SELECT id FROM ordenes_produccion WHERE codigo_orden = 'OP-TEST-ASH-PLAN' LIMIT 1);
SET @op_proc := (SELECT id FROM ordenes_produccion WHERE codigo_orden = 'OP-TEST-CG-PROC' LIMIT 1);

INSERT INTO aprobaciones (codigo_solicitud, accion, payload, solicitado_por, estado, expira_en, creado_en)
VALUES
('REQ-900001', 'SOLICITAR_INICIO_PRODUCCION', JSON_OBJECT('order_id', @op_plan, 'operario_phone', '573174442659'), @user_operario, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 7 DAY), NOW()),
('REQ-900002', 'SOLICITAR_DESPACHO', JSON_OBJECT('lpn', 'TEST_AGENT-PTCG-DISP', 'product_id', @pt_cg, 'qty', 5, 'customer', 'Cliente TEST_AGENT', 'operario_phone', '573174442659', 'fifo_auto', false), @user_operario, 'PENDIENTE', DATE_ADD(NOW(), INTERVAL 7 DAY), NOW());

-- Kardex y movimientos de base para trazabilidad.
INSERT INTO movimientos (tipo, producto_id, bodega_dest, lote, cantidad, referencia_tipo, usuario_id)
VALUES
('entrada', @mp_ash, @bodega_ppal, 'TEST_AGENT-MPASH-FIFO-OLD', 500, 'TEST_AGENT', @user_operario),
('entrada', @mp_cg, @bodega_ppal, 'TEST_AGENT-MPCG-FIFO-OLD', 420, 'TEST_AGENT', @user_operario),
('entrada', @pt_ash, @bodega_ppal, 'TEST_AGENT-PTASH-DISP', 120, 'TEST_AGENT', @user_operario),
('salida', @pt_ash, NULL, 'TEST_AGENT-PTASH-DISP', 10, 'TEST_AGENT', @user_operario);

INSERT INTO kardex (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after, reference, notes, approved_by, created_at)
VALUES
(UUID(), UUID(), 'aaaaaaaa-0000-0000-0000-000000000001', @mp_ash, @user_operario, 'INGRESO_RECEPCION', 500, 825, 'TEST_AGENT:REC-TEST-AGENT-001', 'TEST_AGENT ingreso MP Ashwagandha', NULL, NOW()),
(UUID(), UUID(), 'aaaaaaaa-0000-0000-0000-000000000004', @mp_cg, @user_operario, 'INGRESO_RECEPCION', 420, 450, 'TEST_AGENT:REC-TEST-AGENT-001', 'TEST_AGENT ingreso MP Creagums', NULL, NOW()),
(UUID(), UUID(), 'aaaaaaaa-0000-0000-0000-000000000006', @pt_ash, @user_operario, 'CIERRE_PRODUCCION', 120, 120, 'TEST_AGENT:OP-TEST-ASH-CERR', 'TEST_AGENT PT disponible', @user_supervisor, NOW()),
(UUID(), UUID(), 'aaaaaaaa-0000-0000-0000-000000000006', @pt_ash, @user_operario, 'DESPACHO', -10, 110, 'TEST_AGENT:DSP-TEST-AGENT-001', 'TEST_AGENT despacho historico', @user_supervisor, NOW());

COMMIT;
