-- Document intake from BuilderBot/dashboard. Extraction creates reviewable
-- drafts only; it never reserves or changes inventory.
CREATE TABLE IF NOT EXISTS documentos_bodega_borrador (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo_documento VARCHAR(50) NOT NULL,
  origen ENUM('BUILDERBOT','DASHBOARD') NOT NULL,
  referencia_documento VARCHAR(80) NOT NULL,
  fecha_documento DATE NOT NULL,
  destinatario_nombre VARCHAR(200) NOT NULL,
  direccion VARCHAR(255) NULL,
  ciudad_departamento VARCHAR(160) NULL,
  nit VARCHAR(80) NULL,
  telefono VARCHAR(40) NULL,
  total_bultos DECIMAL(15,4) NULL,
  total_unidades DECIMAL(15,4) NOT NULL,
  total_calculado DECIMAL(15,4) NOT NULL,
  entrega VARCHAR(160) NULL,
  recibe VARCHAR(160) NULL,
  nombre_archivo VARCHAR(255) NULL,
  referencia_origen VARCHAR(255) NULL,
  advertencias JSON NULL,
  sha256 CHAR(64) NOT NULL,
  estado ENUM('PENDIENTE_REVISION','REQUIERE_CORRECCION','VINCULADO','DESCARTADO')
    NOT NULL DEFAULT 'PENDIENTE_REVISION',
  maquila_envio_id INT UNSIGNED NULL,
  creado_por INT UNSIGNED NOT NULL,
  revisado_por INT UNSIGNED NULL,
  revisado_en DATETIME NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_documento_origen_referencia (origen, referencia_documento),
  INDEX idx_documento_estado (estado, creado_en),
  INDEX idx_documento_envio (maquila_envio_id),
  CONSTRAINT fk_documento_envio FOREIGN KEY (maquila_envio_id) REFERENCES maquila_envios(id),
  CONSTRAINT fk_documento_creado FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_documento_revisado FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documento_bodega_borrador_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  documento_id INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NULL,
  sku_extraido VARCHAR(80) NOT NULL,
  descripcion_extraida VARCHAR(255) NOT NULL,
  cantidad DECIMAL(15,4) NOT NULL,
  fecha_vencimiento DATE NULL,
  lote VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_documento_item_documento (documento_id),
  INDEX idx_documento_item_sku (sku_extraido),
  CONSTRAINT fk_documento_item_documento FOREIGN KEY (documento_id)
    REFERENCES documentos_bodega_borrador(id) ON DELETE CASCADE,
  CONSTRAINT fk_documento_item_producto FOREIGN KEY (producto_id) REFERENCES productos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
