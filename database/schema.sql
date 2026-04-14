-- ============================================================
--  WMS — Esquema de Base de Datos MySQL
--  Versión 2.0 — Integración completa SIIGO API
-- ============================================================

CREATE DATABASE IF NOT EXISTS wms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wms_db;

-- ══════════════════════════════════════════════════════════════
--  1. USUARIOS Y ROLES
-- ══════════════════════════════════════════════════════════════
CREATE TABLE roles (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50)  NOT NULL,
  descripcion VARCHAR(200),
  creado_en   DATETIME     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol_id        INT UNSIGNED NOT NULL,
  activo        TINYINT(1)   DEFAULT 1,
  creado_en     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rol_id) REFERENCES roles(id)
);

-- ══════════════════════════════════════════════════════════════
--  2. BODEGAS Y UBICACIONES
-- ══════════════════════════════════════════════════════════════
CREATE TABLE bodegas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(20)  NOT NULL UNIQUE,
  nombre      VARCHAR(100) NOT NULL,
  direccion   VARCHAR(255),
  activa      TINYINT(1)   DEFAULT 1,
  siigo_id    INT,                         -- ID numérico de bodega en SIIGO (warehouses.id)
  siigo_nombre VARCHAR(100),               -- nombre en SIIGO para validación
  creado_en   DATETIME     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ubicaciones (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bodega_id   INT UNSIGNED NOT NULL,
  codigo      VARCHAR(30)  NOT NULL,       -- Ej: A-01-02 (zona-pasillo-nivel)
  zona        VARCHAR(30),
  pasillo     VARCHAR(10),
  nivel       VARCHAR(10),
  posicion    VARCHAR(10),
  activa      TINYINT(1)   DEFAULT 1,
  creado_en   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  UNIQUE KEY uk_ubicacion (bodega_id, codigo)
);

-- ══════════════════════════════════════════════════════════════
--  3. TERCEROS — Clientes y Proveedores (mapeado a SIIGO /v1/customers)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE terceros (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  siigo_id         VARCHAR(60)  UNIQUE,                       -- UUID retornado por SIIGO
  tipo             ENUM('Customer','Supplier','Other') DEFAULT 'Customer',
  person_type      ENUM('person','company')            NOT NULL,
  id_type          VARCHAR(10)  NOT NULL,                     -- 13=cédula, 31=NIT, 41=pasaporte...
  identification   VARCHAR(50)  NOT NULL,
  check_digit      CHAR(1)      NULL,                         -- dígito de verificación NIT
  nombre           VARCHAR(200) NOT NULL,
  nombre_comercial VARCHAR(200) NULL,
  branch_office    SMALLINT     DEFAULT 0,
  activo           TINYINT(1)   DEFAULT 1,
  vat_responsible  TINYINT(1)   DEFAULT 0,                    -- responsable de IVA
  responsabilidad_fiscal VARCHAR(20) DEFAULT 'R-99-PN',
  -- Dirección
  direccion        VARCHAR(256) NULL,
  city_code        VARCHAR(10)  NULL,                         -- código ciudad SIIGO (ej: 11001)
  state_code       VARCHAR(10)  NULL,                         -- código dpto (ej: 11)
  country_code     VARCHAR(5)   DEFAULT 'CO',
  postal_code      VARCHAR(10)  NULL,
  -- Contacto
  telefono         VARCHAR(20)  NULL,
  email_contacto   VARCHAR(100) NULL,
  comentarios      TEXT         NULL,
  -- Vendedor/cobrador asignado en SIIGO
  siigo_seller_id  INT          NULL,
  siigo_collector_id INT        NULL,
  -- Sincronización
  siigo_synced_at  DATETIME     NULL,
  creado_en        DATETIME     DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_terceros_identification (identification),
  INDEX idx_terceros_tipo (tipo)
);

-- ══════════════════════════════════════════════════════════════
--  4. CATÁLOGO DE COMPROBANTES SIIGO (cache de /v1/document-types)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE siigo_documentos (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  siigo_id              INT          NOT NULL UNIQUE,          -- ID numérico en SIIGO
  codigo                VARCHAR(20)  NOT NULL,                 -- ej: FV, FC, NC
  nombre                VARCHAR(100) NOT NULL,
  tipo                  VARCHAR(5)   NOT NULL,                 -- FV=factura venta, FC=compra, AJ=ajuste
  activo                TINYINT(1)   DEFAULT 1,
  numero_automatico     TINYINT(1)   DEFAULT 1,
  proximo_consecutivo   INT          NULL,
  seller_by_item        TINYINT(1)   DEFAULT 0,
  cost_center           TINYINT(1)   DEFAULT 0,
  electronico           TINYINT(1)   DEFAULT 0,
  actualizado_en        DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ══════════════════════════════════════════════════════════════
--  5. PRODUCTOS (sincronizados desde SIIGO /v1/products)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE productos (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Identificadores SIIGO
  siigo_id            VARCHAR(60)  UNIQUE,                     -- UUID del producto en SIIGO
  siigo_code          VARCHAR(30)  NOT NULL UNIQUE,            -- código en SIIGO (máx 30, sin espacios)
  siigo_account_group INT          NULL,                       -- clasificación inventario SIIGO
  -- Datos generales
  nombre              VARCHAR(255) NOT NULL,
  descripcion         TEXT,
  tipo_producto       ENUM('Product','Service','Combo','ConsumerGood') DEFAULT 'Product',
  control_stock       TINYINT(1)   DEFAULT 0,                  -- stockcontrol en SIIGO
  activo              TINYINT(1)   DEFAULT 1,
  -- Medidas físicas (propias del WMS)
  peso_kg             DECIMAL(10,3),
  volumen_m3          DECIMAL(10,4),
  requiere_lote       TINYINT(1)   DEFAULT 0,
  requiere_serial     TINYINT(1)   DEFAULT 0,
  -- Fiscales / DIAN
  tax_classification  ENUM('Taxed','Exempt','Excluded') DEFAULT 'Taxed',
  tax_included        TINYINT(1)   DEFAULT 0,                  -- IVA incluido en precio
  unit_code           VARCHAR(10)  DEFAULT '94',               -- unidad medida DIAN
  unit_label          VARCHAR(30)  NULL,                       -- texto libre en PDF factura
  tariff              VARCHAR(10)  NULL,                       -- código arancelario
  -- Referencias comerciales
  referencia          VARCHAR(80)  NULL,                       -- código de fábrica
  barcode             VARCHAR(50)  NULL,                       -- código de barras
  marca               VARCHAR(50)  NULL,
  modelo              VARCHAR(50)  NULL,
  -- Precio base (lista 1 en COP, referencia rápida)
  precio_venta        DECIMAL(18,2) NULL,
  -- Sincronización
  siigo_synced_at     DATETIME     NULL,
  creado_en           DATETIME     DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_productos_barcode (barcode),
  INDEX idx_productos_marca (marca)
);

-- ══════════════════════════════════════════════════════════════
--  6. STOCK (inventario por ubicación)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE stock (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id     INT UNSIGNED NOT NULL,
  bodega_id       INT UNSIGNED NOT NULL,
  ubicacion_id    INT UNSIGNED NULL,
  lote            VARCHAR(50),
  serial          VARCHAR(100),
  fecha_venc      DATE,
  cantidad        DECIMAL(15,4) NOT NULL DEFAULT 0,
  reservada       DECIMAL(15,4) NOT NULL DEFAULT 0,            -- en proceso de despacho
  actualizado_en  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (producto_id)  REFERENCES productos(id),
  FOREIGN KEY (bodega_id)    REFERENCES bodegas(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  INDEX idx_stock_producto_bodega (producto_id, bodega_id)
);

-- ══════════════════════════════════════════════════════════════
--  7. RECEPCIONES (genera Factura de Compra en SIIGO /v1/purchases)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE recepciones (
  id                       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero                   VARCHAR(30)  NOT NULL UNIQUE,
  -- Proveedor (FK a terceros)
  tercero_id               INT UNSIGNED NULL,
  proveedor_nombre         VARCHAR(200),                       -- desnormalizado para historial
  -- Factura del proveedor físico
  proveedor_invoice_prefix VARCHAR(6)   NULL,
  proveedor_invoice_number VARCHAR(11)  NULL,
  proveedor_invoice_date   DATE         NULL,
  -- Bodega destino
  bodega_id                INT UNSIGNED NOT NULL,
  -- Estado WMS
  estado                   ENUM('borrador','en_proceso','completada','anulada') DEFAULT 'borrador',
  usuario_id               INT UNSIGNED NOT NULL,
  observaciones            TEXT,
  -- Integración SIIGO
  siigo_purchase_id        VARCHAR(60)  NULL UNIQUE,           -- UUID en SIIGO tras crear la compra
  siigo_purchase_name      VARCHAR(50)  NULL,                  -- ej: "FC-001-123"
  siigo_document_id        INT          NULL,                  -- FK a siigo_documentos.siigo_id
  moneda                   VARCHAR(5)   DEFAULT 'COP',
  costo_total              DECIMAL(18,2) NULL,
  siigo_synced_at          DATETIME     NULL,
  -- Timestamps
  creado_en                DATETIME     DEFAULT CURRENT_TIMESTAMP,
  completado_en            DATETIME,
  FOREIGN KEY (bodega_id)   REFERENCES bodegas(id),
  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
  FOREIGN KEY (tercero_id)  REFERENCES terceros(id)
);

CREATE TABLE recepcion_items (
  id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  recepcion_id    INT UNSIGNED  NOT NULL,
  producto_id     INT UNSIGNED  NOT NULL,
  ubicacion_id    INT UNSIGNED  NULL,
  lote            VARCHAR(50),
  fecha_venc      DATE,
  cantidad_esp    DECIMAL(15,4) NOT NULL,                      -- cantidad esperada
  cantidad_rec    DECIMAL(15,4) DEFAULT 0,                     -- cantidad recibida
  precio_unitario DECIMAL(18,6) NULL,                         -- para costeo y envío a SIIGO
  descuento       DECIMAL(10,2) DEFAULT 0,
  bodega_siigo_id INT           NULL,                          -- items.warehouse en SIIGO
  FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  FOREIGN KEY (producto_id)  REFERENCES productos(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
);

-- ══════════════════════════════════════════════════════════════
--  8. DESPACHOS (genera Factura de Venta en SIIGO /v1/invoices)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE despachos (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero                VARCHAR(30)  NOT NULL UNIQUE,
  -- Cliente (FK a terceros)
  tercero_id            INT UNSIGNED NULL,
  cliente_nombre        VARCHAR(200),                          -- desnormalizado para historial
  -- Bodega origen
  bodega_id             INT UNSIGNED NOT NULL,
  -- Estado WMS
  estado                ENUM('borrador','picking','empaque','despachado','anulado') DEFAULT 'borrador',
  usuario_id            INT UNSIGNED NOT NULL,
  observaciones         TEXT,
  -- Integración SIIGO
  siigo_invoice_id      VARCHAR(60)  NULL UNIQUE,              -- UUID en SIIGO
  siigo_invoice_name    VARCHAR(50)  NULL,                     -- ej: "FV-003-457"
  siigo_document_id     INT          NULL,                     -- FK a siigo_documentos.siigo_id
  siigo_seller_id       INT          NULL,                     -- vendedor en SIIGO
  cufe                  VARCHAR(200) NULL,                     -- CUFE DIAN factura electrónica
  stamp_status          ENUM('Draft','Accepted','Rejected') NULL,
  moneda                VARCHAR(5)   DEFAULT 'COP',
  total_factura         DECIMAL(18,2) NULL,
  siigo_synced_at       DATETIME     NULL,
  -- Timestamps
  creado_en             DATETIME     DEFAULT CURRENT_TIMESTAMP,
  despachado_en         DATETIME,
  FOREIGN KEY (bodega_id)   REFERENCES bodegas(id),
  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
  FOREIGN KEY (tercero_id)  REFERENCES terceros(id)
);

CREATE TABLE despacho_items (
  id              INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  despacho_id     INT UNSIGNED  NOT NULL,
  producto_id     INT UNSIGNED  NOT NULL,
  ubicacion_id    INT UNSIGNED  NULL,
  lote            VARCHAR(50),
  cantidad_sol    DECIMAL(15,4) NOT NULL,                      -- solicitada
  cantidad_des    DECIMAL(15,4) DEFAULT 0,                     -- despachada
  precio_unitario DECIMAL(18,6) NULL,                         -- precio en SIIGO
  descuento       DECIMAL(10,2) DEFAULT 0,
  bodega_siigo_id INT           NULL,                          -- items.warehouse en SIIGO
  FOREIGN KEY (despacho_id)  REFERENCES despachos(id),
  FOREIGN KEY (producto_id)  REFERENCES productos(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
);

-- ══════════════════════════════════════════════════════════════
--  9. MOVIMIENTOS — Bitácora general de stock
-- ══════════════════════════════════════════════════════════════
CREATE TABLE movimientos (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo             ENUM('entrada','salida','traslado','ajuste') NOT NULL,
  producto_id      INT UNSIGNED NOT NULL,
  bodega_orig      INT UNSIGNED NULL,
  bodega_dest      INT UNSIGNED NULL,
  ubicacion_orig   INT UNSIGNED NULL,
  ubicacion_dest   INT UNSIGNED NULL,
  lote             VARCHAR(50),
  cantidad         DECIMAL(15,4) NOT NULL,
  referencia_id    INT UNSIGNED  NULL,                         -- ID recepcion o despacho
  referencia_tipo  VARCHAR(20)   NULL,                         -- 'recepcion' | 'despacho' | 'ajuste'
  usuario_id       INT UNSIGNED  NOT NULL,
  -- Integración SIIGO
  siigo_sync       TINYINT(1)    DEFAULT 0,                    -- ¿ya enviado a SIIGO?
  siigo_voucher_id VARCHAR(60)   NULL,                         -- UUID del comprobante en SIIGO
  siigo_resp       JSON          NULL,                         -- respuesta completa de SIIGO
  creado_en        DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (producto_id) REFERENCES productos(id),
  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
  INDEX idx_mov_producto (producto_id),
  INDEX idx_mov_tipo (tipo),
  INDEX idx_mov_siigo_sync (siigo_sync)
);

-- ══════════════════════════════════════════════════════════════
--  10. SIIGO_SYNC_LOG — Trazabilidad completa de llamadas API
-- ══════════════════════════════════════════════════════════════
CREATE TABLE siigo_sync_log (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entidad       VARCHAR(30)   NOT NULL,                        -- 'producto','tercero','factura','compra'
  entidad_id    INT UNSIGNED  NULL,                            -- ID local del registro
  operacion     VARCHAR(10)   NOT NULL,                        -- 'CREATE','UPDATE','SYNC','DELETE'
  endpoint      VARCHAR(100)  NULL,                            -- ej: '/v1/invoices'
  metodo_http   VARCHAR(6)    NULL,                            -- GET, POST, PUT, DELETE
  siigo_id      VARCHAR(60)   NULL,                            -- UUID en SIIGO (si aplica)
  request_body  JSON          NULL,
  response_body JSON          NULL,
  status_code   SMALLINT      NULL,                            -- HTTP status code
  error_msg     TEXT          NULL,
  duracion_ms   INT           NULL,                            -- tiempo de respuesta
  creado_en     DATETIME      DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sync_log_entidad (entidad, entidad_id),
  INDEX idx_sync_log_status (status_code),
  INDEX idx_sync_log_fecha (creado_en)
);

-- ══════════════════════════════════════════════════════════════
--  11. CONFIGURACIÓN SIIGO — Tokens y parámetros
-- ══════════════════════════════════════════════════════════════
CREATE TABLE siigo_config (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clave           VARCHAR(60)  NOT NULL UNIQUE,                -- nombre del parámetro
  valor           TEXT         NULL,
  descripcion     VARCHAR(200) NULL,
  actualizado_en  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Valores iniciales de configuración
INSERT INTO siigo_config (clave, descripcion) VALUES
  ('access_token',       'Token JWT activo de SIIGO (válido 24h)'),
  ('token_expiry',       'Fecha/hora de expiración del token (UTC)'),
  ('partner_id',         'Nombre de la aplicación registrada en SIIGO'),
  ('default_seller_id',  'ID del vendedor por defecto en SIIGO'),
  ('doc_id_factura_vta', 'ID del tipo de comprobante para facturas de venta'),
  ('doc_id_factura_cmp', 'ID del tipo de comprobante para facturas de compra'),
  ('doc_id_ajuste',      'ID del tipo de comprobante para ajustes de inventario');

-- ══════════════════════════════════════════════════════════════
--  12. DATOS INICIALES
-- ══════════════════════════════════════════════════════════════
INSERT INTO roles (nombre, descripcion) VALUES
  ('admin',      'Administrador del sistema con acceso total'),
  ('supervisor', 'Supervisor de bodega — aprueba movimientos'),
  ('operario',   'Operario de bodega — ejecuta recepciones y despachos'),
  ('consulta',   'Solo lectura de inventario y reportes');
