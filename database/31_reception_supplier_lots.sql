-- Additive migration. Apply before publishing receipt partition support.
-- Existing rows retain their original lot through COALESCE(lote_proveedor, lote).
ALTER TABLE recepcion_distribuciones
  ADD COLUMN lote_proveedor VARCHAR(80) NULL AFTER lote,
  ADD INDEX idx_recepcion_dist_proveedor (lote_proveedor);
