-- Facturas de venta de SIIGO que no pudieron convertirse en despacho.
-- Una fila por factura; se reabre si vuelve a fallar y se resuelve al importarse.
-- api/_lib/siigo.invoice-issues.js la crea si no existe.
CREATE TABLE IF NOT EXISTS siigo_factura_novedades (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  siigo_invoice_id VARCHAR(80) NOT NULL,
  siigo_invoice_name VARCHAR(80) NULL,
  fecha_factura DATE NULL,
  cliente_identificacion VARCHAR(40) NULL,
  tipo VARCHAR(40) NOT NULL,
  detalle TEXT NULL,
  codigos TEXT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
  intentos INT UNSIGNED NOT NULL DEFAULT 1,
  primera_vez DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_intento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelta_en DATETIME NULL,
  resuelta_por INT UNSIGNED NULL,
  nota VARCHAR(255) NULL,
  UNIQUE KEY uk_siigo_factura_novedad (siigo_invoice_id),
  INDEX idx_siigo_factura_novedad_estado (estado)
);
