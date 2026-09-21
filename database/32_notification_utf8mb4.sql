-- The outbound messages contain operational emojis. MySQL utf8mb3 cannot
-- represent four-byte Unicode code points, so convert the complete queue table.
ALTER TABLE notificaciones_salida
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
