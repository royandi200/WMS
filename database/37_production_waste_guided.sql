-- Estado conversacional de una merma de produccion. No modifica inventario.
CREATE TABLE IF NOT EXISTS produccion_merma_borradores (
  usuario_id INT UNSIGNED NOT NULL PRIMARY KEY,
  orden_produccion_id INT UNSIGNED NULL,
  payload_json JSON NOT NULL,
  estado ENUM('PENDIENTE','CONFIRMADO') NOT NULL DEFAULT 'PENDIENTE',
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_merma_borrador_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_merma_borrador_orden FOREIGN KEY (orden_produccion_id)
    REFERENCES ordenes_produccion(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
