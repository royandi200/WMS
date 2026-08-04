CREATE TABLE IF NOT EXISTS recepcion_conciliacion_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recepcion_id INT UNSIGNED NOT NULL,
  orden_compra_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad_oc DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_factura DECIMAL(15,4) NOT NULL DEFAULT 0,
  cantidad_fisica DECIMAL(15,4) NOT NULL DEFAULT 0,
  diferencia_oc_factura DECIMAL(15,4) NOT NULL DEFAULT 0,
  diferencia_factura_fisica DECIMAL(15,4) NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_recepcion_conciliacion_producto (recepcion_id, producto_id),
  FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra_proveedor(id),
  FOREIGN KEY (producto_id) REFERENCES productos(id)
);
