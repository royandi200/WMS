CREATE TABLE IF NOT EXISTS usuario_whatsapp_aliases (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  alias VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_usuario_whatsapp_alias (alias),
  KEY idx_usuario_whatsapp_alias_usuario (usuario_id),
  CONSTRAINT fk_usuario_whatsapp_alias_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON UPDATE CASCADE ON DELETE CASCADE
);
