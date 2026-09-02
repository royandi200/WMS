-- Reposiciones auditables de materiales para una OP que sigue EN_PROCESO.
-- La preparacion reserva por FEFO; la confirmacion del alistador descuenta.

CREATE TABLE IF NOT EXISTS produccion_reposiciones (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo                VARCHAR(50) NOT NULL UNIQUE,
  orden_produccion_id   INT UNSIGNED NOT NULL,
  cantidad_objetivo     DECIMAL(15,4) NOT NULL,
  motivo                VARCHAR(500) NOT NULL,
  estado                ENUM('PENDIENTE_ALISTAMIENTO','CONFIRMADA','CANCELADA')
                        NOT NULL DEFAULT 'PENDIENTE_ALISTAMIENTO',
  solicitada_por        INT UNSIGNED NOT NULL,
  confirmada_por        INT UNSIGNED NULL,
  cancelada_por         INT UNSIGNED NULL,
  creada_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmada_en         DATETIME NULL,
  cancelada_en          DATETIME NULL,

  CONSTRAINT fk_prod_rep_orden FOREIGN KEY (orden_produccion_id)
    REFERENCES ordenes_produccion(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_rep_solicita FOREIGN KEY (solicitada_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_rep_confirma FOREIGN KEY (confirmada_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_rep_cancela FOREIGN KEY (cancelada_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT,
  INDEX idx_prod_rep_orden_estado (orden_produccion_id, estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estas tablas historicas eran MyISAM. La reposicion y los flujos existentes
-- requieren rollback real junto con stock, lots, movimientos y kardex.
ALTER TABLE produccion_materiales ENGINE=InnoDB;
ALTER TABLE produccion_material_lotes ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS produccion_reposicion_items (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reposicion_id            INT UNSIGNED NOT NULL,
  produccion_material_id   INT UNSIGNED NOT NULL,
  cantidad_requerida       DECIMAL(15,4) NOT NULL,
  unidad                   VARCHAR(20) NULL,
  creado_en                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_prod_rep_item_rep FOREIGN KEY (reposicion_id)
    REFERENCES produccion_reposiciones(id) ON DELETE RESTRICT,
  CONSTRAINT fk_prod_rep_item_mat FOREIGN KEY (produccion_material_id)
    REFERENCES produccion_materiales(id) ON DELETE RESTRICT,
  CONSTRAINT uq_prod_rep_item UNIQUE (reposicion_id, produccion_material_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
