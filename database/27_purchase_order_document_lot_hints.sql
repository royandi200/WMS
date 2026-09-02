-- Preserve supplier-document lot and expiry as reception hints. These values do
-- not create stock and remain subject to physical verification at confirmation.

ALTER TABLE orden_compra_proveedor_items
  ADD COLUMN lote_documento VARCHAR(100) NULL AFTER precio_unitario,
  ADD COLUMN fecha_vencimiento_documento DATE NULL AFTER lote_documento;
