-- Persist the validated physical receipt preview so final confirmation never
-- depends on BuilderBot conversation memory or an LLM-reconstructed payload.

CREATE TABLE IF NOT EXISTS recepcion_confirmacion_borradores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  recepcion_id INT UNSIGNED NOT NULL,
  orden_compra_id INT UNSIGNED NOT NULL,
  usuario_id INT UNSIGNED NOT NULL,
  payload_json JSON NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  estado ENUM('PENDIENTE', 'CONSUMIDO') NOT NULL DEFAULT 'PENDIENTE',
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  consumido_en DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_recepcion_confirmacion_borrador (recepcion_id),
  KEY idx_recepcion_confirmacion_orden (orden_compra_id),
  KEY idx_recepcion_confirmacion_usuario (usuario_id),
  KEY idx_recepcion_confirmacion_estado_expira (estado, expira_en),
  CONSTRAINT fk_recepcion_confirmacion_recepcion
    FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  CONSTRAINT fk_recepcion_confirmacion_orden
    FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  CONSTRAINT fk_recepcion_confirmacion_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
