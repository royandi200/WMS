-- ============================================================
--  WMS — Esquema de Base de Datos MySQL
-- ============================================================

CREATE DATABASE IF NOT EXISTS wms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE wms_db;

-- ──────────────────────────────────────────────────────────
--  USUARIOS Y ROLES
-- ──────────────────────────────────────────────────────────
CREATE TABLE roles (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(50) NOT NULL,
  descripcion VARCHAR(200),
  creado_en   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol_id        INT UNSIGNED NOT NULL,
  activo        TINYINT(1) DEFAULT 1,
  creado_en     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rol_id) REFERENCES roles(id)
);

-- ──────────────────────────────────────────────────────────
--  BODEGAS Y UBICACIONES
-- ──────────────────────────────────────────────────────────
CREATE TABLE bodegas (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(20) NOT NULL UNIQUE,
  nombre      VARCHAR(100) NOT NULL,
  direccion   VARCHAR(255),
  activa      TINYINT(1) DEFAULT 1,
  siigo_id    VARCHAR(50),          -- ID de bodega en SIIGO
  creado_en   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ubicaciones (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bodega_id   INT UNSIGNED NOT NULL,
  codigo      VARCHAR(30) NOT NULL,   -- Ej: A-01-02 (zona-pasillo-nivel)
  zona        VARCHAR(30),
  pasillo     VARCHAR(10),
  nivel       VARCHAR(10),
  posicion    VARCHAR(10),
  activa      TINYINT(1) DEFAULT 1,
  creado_en   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  UNIQUE KEY uk_ubicacion (bodega_id, codigo)
);

-- ──────────────────────────────────────────────────────────
--  PRODUCTOS (sincronizados desde SIIGO)
-- ──────────────────────────────────────────────────────────
CREATE TABLE productos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  siigo_id        VARCHAR(50) UNIQUE,
  codigo          VARCHAR(50) NOT NULL UNIQUE,
  nombre          VARCHAR(255) NOT NULL,
  descripcion     TEXT,
  unidad_medida   VARCHAR(30),
  peso_kg         DECIMAL(10,3),
  volumen_m3      DECIMAL(10,4),
  requiere_lote   TINYINT(1) DEFAULT 0,
  requiere_serial TINYINT(1) DEFAULT 0,
  activo          TINYINT(1) DEFAULT 1,
  actualizado_en  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  creado_en       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ──────────────────────────────────────────────────────────
--  STOCK (inventario por ubicación)
-- ──────────────────────────────────────────────────────────
CREATE TABLE stock (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id   INT UNSIGNED NOT NULL,
  bodega_id     INT UNSIGNED NOT NULL,
  ubicacion_id  INT UNSIGNED,
  lote          VARCHAR(50),
  serial        VARCHAR(100),
  fecha_venc    DATE,
  cantidad      DECIMAL(15,4) NOT NULL DEFAULT 0,
  reservada     DECIMAL(15,4) NOT NULL DEFAULT 0,  -- en proceso de despacho
  actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (producto_id)  REFERENCES productos(id),
  FOREIGN KEY (bodega_id)    REFERENCES bodegas(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
);

-- ──────────────────────────────────────────────────────────
--  RECEPCIONES
-- ──────────────────────────────────────────────────────────
CREATE TABLE recepciones (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero               VARCHAR(30) NOT NULL UNIQUE,
  siigo_orden_compra   VARCHAR(50),           -- número OC en SIIGO
  proveedor_siigo_id   VARCHAR(50),
  proveedor_nombre     VARCHAR(200),
  bodega_id            INT UNSIGNED NOT NULL,
  estado               ENUM('borrador','en_proceso','completada','anulada') DEFAULT 'borrador',
  usuario_id           INT UNSIGNED NOT NULL,
  observaciones        TEXT,
  creado_en            DATETIME DEFAULT CURRENT_TIMESTAMP,
  completado_en        DATETIME,
  FOREIGN KEY (bodega_id)   REFERENCES bodegas(id),
  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)
);

CREATE TABLE recepcion_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recepcion_id    INT UNSIGNED NOT NULL,
  producto_id     INT UNSIGNED NOT NULL,
  ubicacion_id    INT UNSIGNED,
  lote            VARCHAR(50),
  fecha_venc      DATE,
  cantidad_esp    DECIMAL(15,4) NOT NULL,   -- cantidad esperada
  cantidad_rec    DECIMAL(15,4) DEFAULT 0,  -- cantidad recibida
  FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  FOREIGN KEY (producto_id)  REFERENCES productos(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
);

-- ──────────────────────────────────────────────────────────
--  DESPACHOS
-- ──────────────────────────────────────────────────────────
CREATE TABLE despachos (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  numero             VARCHAR(30) NOT NULL UNIQUE,
  siigo_orden_venta  VARCHAR(50),           -- número OV en SIIGO
  cliente_siigo_id   VARCHAR(50),
  cliente_nombre     VARCHAR(200),
  bodega_id          INT UNSIGNED NOT NULL,
  estado             ENUM('borrador','picking','empaque','despachado','anulado') DEFAULT 'borrador',
  usuario_id         INT UNSIGNED NOT NULL,
  observaciones      TEXT,
  creado_en          DATETIME DEFAULT CURRENT_TIMESTAMP,
  despachado_en      DATETIME,
  FOREIGN KEY (bodega_id)  REFERENCES bodegas(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE TABLE despacho_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  despacho_id     INT UNSIGNED NOT NULL,
  producto_id     INT UNSIGNED NOT NULL,
  ubicacion_id    INT UNSIGNED,
  lote            VARCHAR(50),
  cantidad_sol    DECIMAL(15,4) NOT NULL,   -- solicitada
  cantidad_des    DECIMAL(15,4) DEFAULT 0,  -- despachada
  FOREIGN KEY (despacho_id)  REFERENCES despachos(id),
  FOREIGN KEY (producto_id)  REFERENCES productos(id),
  FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id)
);

-- ──────────────────────────────────────────────────────────
--  MOVIMIENTOS (bitácora general)
-- ──────────────────────────────────────────────────────────
CREATE TABLE movimientos (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo          ENUM('entrada','salida','traslado','ajuste') NOT NULL,
  producto_id   INT UNSIGNED NOT NULL,
  bodega_orig   INT UNSIGNED,
  bodega_dest   INT UNSIGNED,
  ubicacion_orig INT UNSIGNED,
  ubicacion_dest INT UNSIGNED,
  lote          VARCHAR(50),
  cantidad      DECIMAL(15,4) NOT NULL,
  referencia_id INT UNSIGNED,             -- ID recepcion o despacho
  referencia_tipo VARCHAR(20),            -- 'recepcion' | 'despacho'
  usuario_id    INT UNSIGNED NOT NULL,
  siigo_sync    TINYINT(1) DEFAULT 0,     -- ¿ya enviado a SIIGO?
  siigo_resp    JSON,                     -- respuesta de SIIGO
  creado_en     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (producto_id)    REFERENCES productos(id),
  FOREIGN KEY (usuario_id)     REFERENCES usuarios(id)
);

-- ──────────────────────────────────────────────────────────
--  DATOS INICIALES
-- ──────────────────────────────────────────────────────────
INSERT INTO roles (nombre, descripcion) VALUES
  ('admin',      'Administrador del sistema con acceso total'),
  ('supervisor', 'Supervisor de bodega — aprueba movimientos'),
  ('operario',   'Operario de bodega — ejecuta recepciones y despachos'),
  ('consulta',   'Solo lectura de inventario y reportes');
