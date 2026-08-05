-- Make warehouse waste reports location-specific and replay-safe.
CREATE TABLE IF NOT EXISTS mermas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(30) NOT NULL,
  tipo ENUM('PROCESO','BODEGA','AJUSTE') NOT NULL DEFAULT 'BODEGA',
  producto_id INT UNSIGNED NOT NULL,
  lote VARCHAR(80) NULL,
  orden_produccion_id INT UNSIGNED NULL,
  cantidad DECIMAL(12,3) NOT NULL,
  motivo VARCHAR(255) NULL,
  usuario_id INT UNSIGNED NOT NULL,
  aprobado_por INT UNSIGNED NULL,
  estado ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mermas_numero (numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE mermas
  ADD COLUMN ubicacion_id INT UNSIGNED NULL AFTER orden_produccion_id,
  ADD COLUMN referencia_externa VARCHAR(80) NULL AFTER ubicacion_id,
  ADD UNIQUE KEY uq_mermas_referencia_externa (referencia_externa),
  ADD INDEX idx_mermas_ubicacion (ubicacion_id),
  ADD CONSTRAINT fk_mermas_ubicacion
    FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id);
