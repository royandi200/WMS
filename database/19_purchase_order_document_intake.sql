-- Purchase orders read from BuilderBot remain reviewable drafts until a
-- reception-capable user converts them into an operational purchase order.

ALTER TABLE documentos_bodega_borrador
  DROP INDEX uk_documento_origen_referencia,
  ADD COLUMN proveedor_nit VARCHAR(80) NULL AFTER nit,
  ADD COLUMN tercero_id INT UNSIGNED NULL AFTER proveedor_nit,
  ADD COLUMN moneda VARCHAR(10) NULL AFTER proveedor_nit,
  ADD COLUMN orden_compra_id INT UNSIGNED NULL AFTER maquila_envio_id,
  ADD UNIQUE KEY uk_documento_tipo_origen_referencia
    (tipo_documento, origen, referencia_documento),
  ADD INDEX idx_documento_orden_compra (orden_compra_id),
  ADD INDEX idx_documento_tercero (tercero_id),
  ADD CONSTRAINT fk_documento_tercero
    FOREIGN KEY (tercero_id) REFERENCES terceros(id),
  ADD CONSTRAINT fk_documento_orden_compra
    FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id);

ALTER TABLE documento_bodega_borrador_items
  ADD COLUMN unidad VARCHAR(20) NULL AFTER cantidad,
  ADD COLUMN precio_unitario DECIMAL(18,6) NULL AFTER unidad;

CREATE TABLE IF NOT EXISTS documento_bodega_borrador_archivos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  documento_id INT UNSIGNED NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  mime_type VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  tamano_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  contenido MEDIUMBLOB NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_documento_borrador_archivo (documento_id),
  CONSTRAINT fk_documento_borrador_archivo
    FOREIGN KEY (documento_id) REFERENCES documentos_bodega_borrador(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
