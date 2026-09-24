-- Customer purchase orders are distinct from supplier purchase orders and
-- never participate in the reception workflow.
CREATE TABLE IF NOT EXISTS pedidos_cliente (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  referencia VARCHAR(80) NOT NULL,
  cliente_nombre VARCHAR(200) NOT NULL,
  fecha_documento DATE NOT NULL,
  documento_borrador_id INT UNSIGNED NOT NULL,
  estado ENUM('ACTIVO','CANCELADO') NOT NULL DEFAULT 'ACTIVO',
  aprobado_por INT UNSIGNED NOT NULL,
  aprobado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pedido_cliente_borrador (documento_borrador_id),
  UNIQUE KEY uq_pedido_cliente_referencia (cliente_nombre, referencia),
  KEY idx_pedido_cliente_estado (estado),
  CONSTRAINT fk_pedido_cliente_borrador FOREIGN KEY (documento_borrador_id)
    REFERENCES documentos_bodega_borrador(id),
  CONSTRAINT fk_pedido_cliente_usuario FOREIGN KEY (aprobado_por)
    REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pedido_cliente_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pedido_cliente_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  cantidad_ordenada DECIMAL(12,3) NOT NULL,
  unidad VARCHAR(20) NOT NULL DEFAULT 'und',
  PRIMARY KEY (id),
  KEY idx_pedido_cliente_items_pedido (pedido_cliente_id),
  CONSTRAINT fk_pedido_cliente_item_pedido FOREIGN KEY (pedido_cliente_id)
    REFERENCES pedidos_cliente(id),
  CONSTRAINT fk_pedido_cliente_item_producto FOREIGN KEY (producto_id)
    REFERENCES productos(id),
  CONSTRAINT ck_pedido_cliente_item_qty CHECK (cantidad_ordenada > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ordenes_produccion
  ADD COLUMN pedido_cliente_item_id INT UNSIGNED NULL AFTER cliente_final,
  ADD KEY idx_op_pedido_cliente_item (pedido_cliente_item_id),
  ADD CONSTRAINT fk_op_pedido_cliente_item FOREIGN KEY (pedido_cliente_item_id)
    REFERENCES pedido_cliente_items(id);
