CREATE TABLE IF NOT EXISTS producto_aliases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id INT UNSIGNED NOT NULL,
  alias VARCHAR(200) NOT NULL,
  alias_normalizado VARCHAR(200) NOT NULL,
  origen ENUM('NOMBRE_OFICIAL','CLIENTE','SISTEMA','DEMO') NOT NULL DEFAULT 'CLIENTE',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_producto_alias_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  UNIQUE KEY uk_producto_alias (producto_id, alias_normalizado),
  INDEX idx_producto_alias_busqueda (alias_normalizado, activo),
  INDEX idx_producto_alias_producto (producto_id, activo)
);
