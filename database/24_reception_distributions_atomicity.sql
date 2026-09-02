-- Receipt distributions participate in the same transaction as lots, stock,
-- movements and kardex. MyISAM silently ignores rollback and foreign keys.

ALTER TABLE recepcion_distribuciones ENGINE=InnoDB;

ALTER TABLE recepcion_distribuciones
  ADD CONSTRAINT fk_recepcion_dist_recepcion
    FOREIGN KEY (recepcion_id) REFERENCES recepciones(id),
  ADD CONSTRAINT fk_recepcion_dist_item
    FOREIGN KEY (recepcion_item_id) REFERENCES recepcion_items(id),
  ADD CONSTRAINT fk_recepcion_dist_ubicacion
    FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones(id),
  ADD CONSTRAINT fk_recepcion_dist_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
