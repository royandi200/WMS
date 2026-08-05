-- Link every customer return to the exact dispatched item and make writes transactional.
ALTER TABLE devoluciones ENGINE = InnoDB;

ALTER TABLE devoluciones
  ADD COLUMN despacho_id INT UNSIGNED NULL AFTER numero,
  ADD COLUMN despacho_item_id INT UNSIGNED NULL AFTER despacho_id,
  ADD COLUMN lote_origen VARCHAR(80) NULL AFTER lote,
  ADD COLUMN ubicacion_id INT UNSIGNED NULL AFTER lote_origen,
  ADD COLUMN referencia_externa VARCHAR(80) NULL AFTER ubicacion_id,
  ADD UNIQUE KEY uq_devolucion_referencia (referencia_externa),
  ADD INDEX idx_devolucion_despacho (despacho_id),
  ADD INDEX idx_devolucion_item (despacho_item_id),
  ADD CONSTRAINT fk_devolucion_despacho FOREIGN KEY (despacho_id) REFERENCES despachos(id),
  ADD CONSTRAINT fk_devolucion_item FOREIGN KEY (despacho_item_id) REFERENCES despacho_items(id),
  ADD CONSTRAINT fk_devolucion_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id);
