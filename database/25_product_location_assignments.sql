CREATE TABLE IF NOT EXISTS producto_ubicaciones (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id         INT UNSIGNED NOT NULL,
  ubicacion_id        INT UNSIGNED NOT NULL,
  prioridad           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  tipo_asignacion     VARCHAR(20) NOT NULL DEFAULT 'SECUNDARIA',
  activa              TINYINT(1) NOT NULL DEFAULT 1,
  fuente              VARCHAR(120) NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_producto_ubicacion_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT fk_producto_ubicacion_ubicacion
    FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  CONSTRAINT chk_producto_ubicacion_tipo
    CHECK (tipo_asignacion IN ('PRIMARIA', 'SECUNDARIA', 'DESBORDE')),
  UNIQUE KEY uq_producto_ubicacion (producto_id, ubicacion_id),
  KEY idx_producto_ubicacion_preferencia (producto_id, activa, prioridad),
  KEY idx_producto_ubicacion_posicion (ubicacion_id, activa)
) ENGINE=InnoDB;
