CREATE TABLE IF NOT EXISTS producto_relaciones_comerciales (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id INT UNSIGNED NOT NULL,
  tipo ENUM('PROVEEDOR','CLIENTE') NOT NULL,
  etiqueta_fuente VARCHAR(200) NOT NULL,
  etiqueta_normalizada VARCHAR(200) NOT NULL,
  tercero_id INT UNSIGNED NULL,
  origen ENUM('GOOGLE_SHEETS','MANUAL','SISTEMA') NOT NULL DEFAULT 'MANUAL',
  fuente_referencia VARCHAR(255) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_producto_relacion_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_producto_relacion_tercero
    FOREIGN KEY (tercero_id) REFERENCES terceros(id) ON DELETE SET NULL,
  UNIQUE KEY uk_producto_relacion (producto_id, tipo, etiqueta_normalizada),
  INDEX idx_producto_relacion_producto (producto_id, tipo, activo),
  INDEX idx_producto_relacion_tercero (tercero_id, activo),
  INDEX idx_producto_relacion_busqueda (tipo, etiqueta_normalizada, activo)
);
