-- Configuración explícita por SKU y proveedor para lotes internos en recepción.
-- Sin una regla activa, se sigue exigiendo el lote informado por el proveedor.
CREATE TABLE IF NOT EXISTS recepcion_lote_reglas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  producto_id INT UNSIGNED NOT NULL,
  tercero_id INT UNSIGNED NOT NULL,
  sigla VARCHAR(8) NOT NULL,
  dias_retroceso SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT UNSIGNED NULL,
  actualizado_por INT UNSIGNED NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_recepcion_lote_producto_proveedor (producto_id, tercero_id),
  CONSTRAINT fk_recepcion_lote_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT fk_recepcion_lote_proveedor FOREIGN KEY (tercero_id) REFERENCES terceros(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
