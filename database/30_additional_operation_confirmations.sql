CREATE TABLE IF NOT EXISTS confirmaciones_adicionales (
  tipo VARCHAR(20) NOT NULL,
  usuario_id BIGINT UNSIGNED NOT NULL,
  registro_base_id BIGINT UNSIGNED NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  resultado JSON NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completado_en DATETIME NULL,
  PRIMARY KEY (tipo, usuario_id, registro_base_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
