-- A direct purchase-order reception is prepared without a Siigo purchase.
-- The key prevents concurrent or repeated preparation of the same open receipt.

ALTER TABLE recepciones
  ADD COLUMN preparacion_clave VARCHAR(80) NULL AFTER siigo_purchase_name,
  ADD UNIQUE KEY uk_recepcion_preparacion_clave (preparacion_clave);

ALTER TABLE ordenes_compra_proveedor
  MODIFY COLUMN estado
    ENUM('CARGADA','FACTURA_VINCULADA','RECIBIDA','RECIBIDA_PARCIAL','CERRADA','CANCELADA')
    NOT NULL DEFAULT 'CARGADA';
