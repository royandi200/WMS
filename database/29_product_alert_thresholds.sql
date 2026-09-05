-- Umbrales operativos configurables por SKU.
-- No modifica saldos, lotes ni movimientos de inventario.

ALTER TABLE productos
  ADD COLUMN permanencia_max_dias SMALLINT UNSIGNED NOT NULL DEFAULT 90
    COMMENT 'Dias maximos de permanencia antes de generar alerta'
    AFTER stock_maximo;
