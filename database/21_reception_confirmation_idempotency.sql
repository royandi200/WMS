-- A WhatsApp confirmation keeps a stable identity after a partial receipt.
-- This prevents an exact retry from being interpreted as a new delivery.

ALTER TABLE recepciones
  ADD COLUMN confirmacion_clave VARCHAR(80) NULL AFTER preparacion_clave,
  ADD UNIQUE KEY uk_recepcion_confirmacion_clave (confirmacion_clave);
