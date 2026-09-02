-- Warehouse workflow extensions.
-- Apply once after 07_workflow_roles.sql. This migration is additive; feature flags
-- keep partial dispatches, split lines and automatic expiry disabled.

CREATE TABLE IF NOT EXISTS ordenes_compra_proveedor (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(60) NOT NULL UNIQUE,
  tercero_id INT UNSIGNED NULL,
  proveedor_nombre VARCHAR(200) NULL,
  fecha_orden DATE NULL,
  estado ENUM('CARGADA','FACTURA_VINCULADA','RECIBIDA','CERRADA','CANCELADA') NOT NULL DEFAULT 'CARGADA',
  archivo_nombre VARCHAR(255) NULL,
  archivo_hash CHAR(64) NULL,
  datos_origen JSON NULL,
  creado_por INT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_oc_proveedor_estado (estado),
  INDEX idx_oc_proveedor_tercero (tercero_id),
  FOREIGN KEY (tercero_id) REFERENCES terceros(id),
  FOREIGN KEY (creado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS orden_compra_proveedor_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orden_compra_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  referencia_origen VARCHAR(80) NULL,
  descripcion_origen VARCHAR(255) NULL,
  cantidad_ordenada DECIMAL(15,4) NOT NULL,
  unidad VARCHAR(20) NULL,
  precio_unitario DECIMAL(18,6) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oc_item_orden (orden_compra_id),
  INDEX idx_oc_item_producto (producto_id),
  FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);

ALTER TABLE recepciones
  ADD COLUMN orden_compra_id INT UNSIGNED NULL AFTER numero,
  ADD COLUMN aprobado_por INT UNSIGNED NULL AFTER usuario_id,
  ADD COLUMN aprobado_en DATETIME NULL AFTER completado_en,
  ADD INDEX idx_recepciones_oc (orden_compra_id);

CREATE TABLE IF NOT EXISTS recepcion_distribuciones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recepcion_id INT UNSIGNED NOT NULL,
  recepcion_item_id INT UNSIGNED NOT NULL,
  ubicacion_id INT UNSIGNED NULL,
  lote VARCHAR(80) NOT NULL,
  fecha_venc DATE NULL,
  condicion ENUM('DISPONIBLE','CUARENTENA','RECHAZADO','PENDIENTE_DISPOSICION') NOT NULL,
  cantidad DECIMAL(15,4) NOT NULL,
  motivo TEXT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recepcion_dist_recepcion (recepcion_id),
  INDEX idx_recepcion_dist_lote (lote),
  INDEX idx_recepcion_dist_condicion (condicion),
  FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  FOREIGN KEY (recepcion_item_id) REFERENCES recepcion_items(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

ALTER TABLE lots MODIFY COLUMN status
  ENUM('DISPONIBLE','CUARENTENA','COMPROMETIDO','DESPACHADO','AGOTADO','RECHAZADO','PENDIENTE_DISPOSICION')
  NOT NULL DEFAULT 'DISPONIBLE';

ALTER TABLE ordenes_produccion
  ADD COLUMN origen_tipo ENUM('OC_CLIENTE','STOCK_SEGURIDAD') NULL AFTER producto_id,
  ADD COLUMN referencia_cliente VARCHAR(80) NULL AFTER origen_tipo,
  ADD COLUMN cliente_final VARCHAR(200) NULL AFTER referencia_cliente,
  ADD COLUMN liberado_por INT UNSIGNED NULL AFTER aprobado_por,
  ADD COLUMN liberado_en DATETIME NULL AFTER materiales_conf_en;

CREATE TABLE IF NOT EXISTS produccion_materiales (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orden_produccion_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad_teorica DECIMAL(15,4) NOT NULL,
  cantidad_reservada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_alistada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_consumida DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_devuelta DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_adicional DECIMAL(15,4) NOT NULL DEFAULT 0,
  unidad VARCHAR(20) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_produccion_material (orden_produccion_id, producto_id),
  FOREIGN KEY (orden_produccion_id) REFERENCES ordenes_produccion(id),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);

CREATE TABLE IF NOT EXISTS produccion_material_lotes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  produccion_material_id INT UNSIGNED NOT NULL,
  stock_id INT UNSIGNED NULL,
  lote VARCHAR(80) NOT NULL,
  ubicacion_id INT UNSIGNED NULL,
  cantidad_reservada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_alistada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_consumida DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_devuelta DECIMAL(15,4) NOT NULL DEFAULT 0,
  es_adicional TINYINT(1) NOT NULL DEFAULT 0,
  confirmado_por INT UNSIGNED NULL,
  confirmado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prod_mat_lote_material (produccion_material_id),
  INDEX idx_prod_mat_lote_lpn (lote),
  FOREIGN KEY (produccion_material_id) REFERENCES produccion_materiales(id),
  FOREIGN KEY (stock_id) REFERENCES stock(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  FOREIGN KEY (confirmado_por) REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS despacho_demanda_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  despacho_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad_facturada DECIMAL(15,4) NOT NULL,
  cantidad_reservada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_despachada DECIMAL(15,4) NOT NULL DEFAULT 0,
  estado ENUM('PENDIENTE_DATOS_CLIENTE','PENDIENTE_STOCK','RESERVADO','PARCIAL','DESPACHADO','CANCELADO') NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_despacho_demanda_producto (despacho_id, producto_id),
  INDEX idx_despacho_demanda_estado (estado),
  FOREIGN KEY (despacho_id) REFERENCES despachos(id),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);
