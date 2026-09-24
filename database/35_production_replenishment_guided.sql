-- Borrador de reposicion guiada por usuario. No reserva ni descuenta stock.
CREATE TABLE IF NOT EXISTS produccion_reposicion_borradores (
  usuario_id INT UNSIGNED NOT NULL PRIMARY KEY,
  orden_produccion_id INT UNSIGNED NOT NULL,
  payload_json JSON NOT NULL,
  estado ENUM('PENDIENTE','CONFIRMADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  reposicion_id INT UNSIGNED NULL,
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_rep_borrador_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_rep_borrador_orden FOREIGN KEY (orden_produccion_id)
    REFERENCES ordenes_produccion(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_rep_borrador_reposicion FOREIGN KEY (reposicion_id)
    REFERENCES produccion_reposiciones(id) ON DELETE RESTRICT,
  INDEX idx_prod_rep_borrador_orden (orden_produccion_id, estado, expira_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
