-- Materiales de embalaje declarados por el operario. No se calculan desde
-- las unidades facturadas ni desde la capacidad nominal de cada caja.
CREATE TABLE IF NOT EXISTS despacho_embalaje_catalogo (
  producto_id INT UNSIGNED NOT NULL PRIMARY KEY,
  clase ENUM('CAJA','TAPA_CAJA_MASTER') NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS despacho_embalaje_borradores (
  usuario_id INT UNSIGNED NOT NULL PRIMARY KEY,
  tipo ENUM('SIIGO','MAQUILA_3Q') NOT NULL,
  referencia_id INT UNSIGNED NOT NULL,
  payload_json JSON NOT NULL,
  expira_en DATETIME NOT NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS despacho_embalaje_consumos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo ENUM('SIIGO','MAQUILA_3Q') NOT NULL,
  referencia_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  stock_id INT UNSIGNED NOT NULL,
  bodega_id INT UNSIGNED NOT NULL,
  ubicacion_id INT UNSIGNED NOT NULL,
  lote VARCHAR(100) NOT NULL,
  cantidad DECIMAL(15,4) NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_embalaje_origen_stock (tipo, referencia_id, stock_id),
  INDEX idx_embalaje_producto (producto_id),
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (stock_id) REFERENCES stock(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SKU confirmado por el usuario. Se crea sin existencias; una recepción real
-- deberá abastecerlo antes de descontar tapas en un despacho.
INSERT INTO productos (siigo_code, nombre, tipo_producto, control_stock, activo,
  requiere_lote, unit_code, unit_label, referencia)
VALUES ('00283-TPDCJM', 'TAPA DE CAJA MASTER', 'Product', 1, 1, 0, '94', 'und', '00283-TPDCJM')
ON DUPLICATE KEY UPDATE siigo_code = siigo_code;

-- Esta referencia también fue entregada por el usuario y aún no existía en
-- el catálogo. Se registra sin stock; no se habilita consumo hasta recibirla.
INSERT INTO productos (siigo_code, nombre, tipo_producto, control_stock, activo,
  requiere_lote, unit_code, unit_label, referencia)
VALUES ('00038-CJ12IN', 'CAJAS X 12 INFINITY', 'Product', 1, 1, 0, '94', 'und', '00038-CJ12IN')
ON DUPLICATE KEY UPDATE siigo_code = siigo_code;

INSERT INTO despacho_embalaje_catalogo (producto_id, clase)
SELECT id, 'CAJA' FROM productos WHERE siigo_code IN
  ('00041-CMCV','00042-CMCG','000291-CMMV','000291-CDMV',
   '00040-CMV','00038-CJ12','00038-CJ12IN','00038-CJ56')
ON DUPLICATE KEY UPDATE clase = VALUES(clase);

INSERT INTO despacho_embalaje_catalogo (producto_id, clase)
SELECT id, 'TAPA_CAJA_MASTER' FROM productos WHERE siigo_code = '00283-TPDCJM'
ON DUPLICATE KEY UPDATE clase = VALUES(clase);
