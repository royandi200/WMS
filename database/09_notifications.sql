CREATE TABLE IF NOT EXISTS notificaciones_salida (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  evento VARCHAR(120) NOT NULL,
  canal VARCHAR(30) NOT NULL,
  destinatario VARCHAR(80) NOT NULL,
  mensaje TEXT NOT NULL,
  estado ENUM('PENDIENTE','ENVIADA','ERROR') NOT NULL DEFAULT 'PENDIENTE',
  intentos INT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_error TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_en DATETIME NULL,
  UNIQUE KEY uk_notificacion_evento_destino (evento, canal, destinatario),
  INDEX idx_notificaciones_estado (estado, creado_en)
);
