-- Origen común del lote interno, incluso cuando la condición crea una partida RECBLK.
ALTER TABLE recepcion_distribuciones
  ADD COLUMN lote_interno_origen VARCHAR(50) NULL AFTER lote_proveedor;
