-- Una revisión explícita del alistamiento por operario. El hash ata la
-- confirmación de WhatsApp a las reservas que realmente se mostraron.
CREATE TABLE IF NOT EXISTS produccion_alistamiento_revisiones (
  usuario_id INT UNSIGNED NOT NULL PRIMARY KEY,
  orden_produccion_id INT UNSIGNED NOT NULL,
  huella CHAR(64) NOT NULL,
  seleccion_pendiente JSON NULL,
  expira_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_alistamiento_revision_orden (orden_produccion_id),
  CONSTRAINT fk_alistamiento_revision_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_alistamiento_revision_orden FOREIGN KEY (orden_produccion_id)
    REFERENCES ordenes_produccion(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
