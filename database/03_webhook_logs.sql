-- ============================================================
--  WMS — Tabla de logs del webhook BuilderBot
--  Ejecutar en kainotomia_WMS DESPUÉS de schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_logs (
  id          INT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  from_phone  VARCHAR(30)   NULL                         COMMENT 'Número WhatsApp que originó el mensaje',
  action      VARCHAR(60)   NOT NULL                     COMMENT '@ction recibida',
  priority    ENUM('alta','media','baja') DEFAULT 'baja',
  payload     JSON          NULL                         COMMENT 'Body completo recibido de BuilderBot',
  response    JSON          NULL                         COMMENT 'Respuesta devuelta al webhook',
  status      ENUM('RECEIVED','PROCESSED','REJECTED','ERROR') NOT NULL DEFAULT 'RECEIVED',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_wl_phone  (from_phone),
  INDEX idx_wl_action (action),
  INDEX idx_wl_status (status),
  INDEX idx_wl_fecha  (created_at)
);

-- VIEW: últimos 500 logs con datos legibles
CREATE OR REPLACE VIEW v_webhook_logs AS
SELECT
  id,
  from_phone,
  action,
  priority,
  status,
  JSON_UNQUOTE(JSON_EXTRACT(response, '$.message')) AS respuesta_bot,
  created_at
FROM webhook_logs
ORDER BY created_at DESC
LIMIT 500;
