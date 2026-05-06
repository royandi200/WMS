-- Migración: tabla de sincronización SysCafé
-- Ejecutar una sola vez en la base de datos de producción
-- Si usas DB_SYNC=true con Sequelize, esta tabla se crea automáticamente

CREATE TABLE IF NOT EXISTS `syscafe_sync_log` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `despacho_id`     INT UNSIGNED NOT NULL,
  `numero`          VARCHAR(30)  NOT NULL,
  `status`          ENUM('pendiente','enviado','error') NOT NULL DEFAULT 'pendiente',
  `intentos`        INT UNSIGNED NOT NULL DEFAULT 0,
  `respuesta`       TEXT,
  `enviado_en`      DATETIME     NULL,
  `creado_en`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_despacho` (`despacho_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_syscafe_despacho`
    FOREIGN KEY (`despacho_id`) REFERENCES `despachos` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
