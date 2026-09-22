CREATE TABLE IF NOT EXISTS usuario_roles (
  usuario_id INT UNSIGNED NOT NULL,
  rol_id INT UNSIGNED NOT NULL,
  es_principal TINYINT(1) NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, rol_id),
  KEY idx_usuario_roles_rol (rol_id, usuario_id),
  CONSTRAINT fk_usuario_roles_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_usuario_roles_rol
    FOREIGN KEY (rol_id) REFERENCES roles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

INSERT IGNORE INTO usuario_roles (usuario_id, rol_id, es_principal, creado_en)
SELECT id, rol_id, 1, COALESCE(creado_en, NOW())
FROM usuarios
WHERE rol_id IS NOT NULL;

ALTER TABLE usuario_whatsapp_aliases
  ADD COLUMN habilitado_salida TINYINT(1) NOT NULL DEFAULT 1 AFTER alias;
