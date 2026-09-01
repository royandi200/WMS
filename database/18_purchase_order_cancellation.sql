-- Auditable logical cancellation for purchase orders.
-- The PDF and item detail remain immutable evidence after cancellation.

ALTER TABLE ordenes_compra_proveedor
  ADD COLUMN motivo_cancelacion VARCHAR(500) NULL AFTER datos_origen,
  ADD COLUMN cancelada_por INT UNSIGNED NULL AFTER motivo_cancelacion,
  ADD COLUMN cancelada_en DATETIME NULL AFTER cancelada_por,
  ADD INDEX idx_oc_cancelada_por (cancelada_por),
  ADD CONSTRAINT fk_oc_cancelada_usuario FOREIGN KEY (cancelada_por) REFERENCES usuarios(id);
