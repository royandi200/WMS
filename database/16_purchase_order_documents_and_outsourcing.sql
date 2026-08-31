-- Purchase-order evidence and outsourced packing (3Q).
-- 3Q is external custody, not a WMS warehouse or location.

-- These workflow tables were created with the server default engine in the
-- current QA database. Convert them before adding transactional relations.
-- Preflight must confirm there are no orphan rows before applying this file.
ALTER TABLE ordenes_compra_proveedor ENGINE=InnoDB;
ALTER TABLE orden_compra_proveedor_items ENGINE=InnoDB;
ALTER TABLE recepcion_conciliacion_items ENGINE=InnoDB;

ALTER TABLE ordenes_compra_proveedor
  ADD CONSTRAINT fk_oc_proveedor_tercero FOREIGN KEY (tercero_id) REFERENCES terceros(id),
  ADD CONSTRAINT fk_oc_proveedor_creado FOREIGN KEY (creado_por) REFERENCES usuarios(id);

ALTER TABLE orden_compra_proveedor_items
  ADD CONSTRAINT fk_oc_item_orden FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  ADD CONSTRAINT fk_oc_item_producto FOREIGN KEY (producto_id) REFERENCES productos(id);

ALTER TABLE recepcion_conciliacion_items
  ADD CONSTRAINT fk_recepcion_conciliacion_recepcion FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  ADD CONSTRAINT fk_recepcion_conciliacion_orden FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  ADD CONSTRAINT fk_recepcion_conciliacion_producto FOREIGN KEY (producto_id) REFERENCES productos(id);

CREATE TABLE IF NOT EXISTS orden_compra_documentos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orden_compra_id INT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  nombre_original VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  tamano_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  contenido MEDIUMBLOB NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  cargado_por INT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_oc_documento_hash (orden_compra_id, sha256),
  INDEX idx_oc_documento_activo (orden_compra_id, activo),
  CONSTRAINT fk_oc_documento_orden
    FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  CONSTRAINT fk_oc_documento_usuario
    FOREIGN KEY (cargado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ordenes_maquila (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  orden_compra_id INT UNSIGNED NOT NULL,
  tercero_id INT UNSIGNED NULL,
  proveedor_nombre VARCHAR(200) NOT NULL DEFAULT '3Q',
  producto_id INT UNSIGNED NOT NULL,
  cantidad_objetivo DECIMAL(15,4) NOT NULL,
  cantidad_recibida DECIMAL(15,4) NOT NULL DEFAULT 0,
  estado ENUM(
    'MATERIALES_RESERVADOS','EN_3Q','RECIBIDA_PARCIAL',
    'COMPLETADA','CANCELADA'
  ) NOT NULL DEFAULT 'MATERIALES_RESERVADOS',
  notas TEXT NULL,
  creado_por INT UNSIGNED NOT NULL,
  enviado_por INT UNSIGNED NULL,
  enviado_en DATETIME NULL,
  completado_por INT UNSIGNED NULL,
  completado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_maquila_estado (estado),
  INDEX idx_maquila_oc (orden_compra_id),
  INDEX idx_maquila_producto (producto_id),
  CONSTRAINT fk_maquila_oc FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  CONSTRAINT fk_maquila_tercero FOREIGN KEY (tercero_id) REFERENCES terceros(id),
  CONSTRAINT fk_maquila_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT fk_maquila_creado FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_maquila_enviado FOREIGN KEY (enviado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_maquila_completado FOREIGN KEY (completado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maquila_materiales (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orden_maquila_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad_teorica DECIMAL(15,4) NOT NULL,
  cantidad_reservada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_enviada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_devuelta DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_conciliada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_merma DECIMAL(15,4) NOT NULL DEFAULT 0,
  unidad VARCHAR(20) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_maquila_material (orden_maquila_id, producto_id),
  CONSTRAINT fk_maquila_material_orden FOREIGN KEY (orden_maquila_id) REFERENCES ordenes_maquila(id),
  CONSTRAINT fk_maquila_material_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maquila_material_lotes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maquila_material_id INT UNSIGNED NOT NULL,
  stock_id INT UNSIGNED NOT NULL,
  bodega_origen_id INT UNSIGNED NOT NULL,
  ubicacion_origen_id INT UNSIGNED NOT NULL,
  lote VARCHAR(100) NOT NULL,
  cantidad_reservada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_enviada DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_devuelta DECIMAL(15,4) NOT NULL DEFAULT 0,
  es_adicional TINYINT(1) NOT NULL DEFAULT 0,
  estado ENUM('RESERVADO','ENVIADO','DEVUELTO','CANCELADO') NOT NULL DEFAULT 'RESERVADO',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_maquila_lote_material (maquila_material_id),
  INDEX idx_maquila_lote_lpn (lote),
  INDEX idx_maquila_lote_stock (stock_id),
  CONSTRAINT fk_maquila_lote_material FOREIGN KEY (maquila_material_id) REFERENCES maquila_materiales(id),
  CONSTRAINT fk_maquila_lote_stock FOREIGN KEY (stock_id) REFERENCES stock(id),
  CONSTRAINT fk_maquila_lote_bodega FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id),
  CONSTRAINT fk_maquila_lote_ubicacion FOREIGN KEY (ubicacion_origen_id) REFERENCES ubicaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maquila_envios (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(45) NOT NULL UNIQUE,
  orden_maquila_id INT UNSIGNED NOT NULL,
  tipo ENUM('INICIAL','ADICIONAL') NOT NULL,
  estado ENUM('BORRADOR','CONFIRMADO','CANCELADO') NOT NULL DEFAULT 'BORRADOR',
  motivo TEXT NULL,
  clave_idempotencia VARCHAR(100) NOT NULL UNIQUE,
  creado_por INT UNSIGNED NOT NULL,
  confirmado_por INT UNSIGNED NULL,
  confirmado_en DATETIME NULL,
  cancelado_por INT UNSIGNED NULL,
  cancelado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_maquila_envio_orden (orden_maquila_id),
  INDEX idx_maquila_envio_estado (estado),
  CONSTRAINT fk_maquila_envio_orden FOREIGN KEY (orden_maquila_id) REFERENCES ordenes_maquila(id),
  CONSTRAINT fk_maquila_envio_creado FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_maquila_envio_confirmado FOREIGN KEY (confirmado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_maquila_envio_cancelado FOREIGN KEY (cancelado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maquila_envio_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  maquila_envio_id INT UNSIGNED NOT NULL,
  maquila_material_lote_id INT UNSIGNED NOT NULL,
  cantidad DECIMAL(15,4) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_maquila_envio_lote (maquila_envio_id, maquila_material_lote_id),
  CONSTRAINT fk_maquila_envio_item_envio FOREIGN KEY (maquila_envio_id) REFERENCES maquila_envios(id),
  CONSTRAINT fk_maquila_envio_item_lote FOREIGN KEY (maquila_material_lote_id) REFERENCES maquila_material_lotes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maquila_recepciones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  orden_maquila_id INT UNSIGNED NOT NULL,
  recepcion_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  vinculado_por INT UNSIGNED NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_maquila_recepcion_orden (orden_maquila_id, recepcion_id),
  UNIQUE KEY uk_maquila_recepcion_producto (recepcion_id, producto_id),
  INDEX idx_maquila_recepcion_recepcion (recepcion_id),
  CONSTRAINT fk_maquila_recepcion_orden FOREIGN KEY (orden_maquila_id) REFERENCES ordenes_maquila(id),
  CONSTRAINT fk_maquila_recepcion_recepcion FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  CONSTRAINT fk_maquila_recepcion_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT fk_maquila_recepcion_usuario FOREIGN KEY (vinculado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE recepcion_conciliacion_items
  ADD COLUMN cantidad_factura_acumulada DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER cantidad_factura,
  ADD COLUMN cantidad_fisica_acumulada DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER cantidad_fisica,
  ADD COLUMN cantidad_aceptada_acumulada DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER cantidad_fisica_acumulada,
  ADD COLUMN saldo_oc DECIMAL(15,4) NOT NULL DEFAULT 0 AFTER diferencia_factura_fisica;
