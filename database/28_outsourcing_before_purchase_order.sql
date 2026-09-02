-- Permite enviar materiales a 3Q antes de recibir la OC del producto terminado.
-- La recepcion queda bloqueada hasta vincular una OC compatible y respaldada por PDF.

ALTER TABLE ordenes_maquila
  MODIFY COLUMN orden_compra_id INT UNSIGNED NULL,
  MODIFY COLUMN estado ENUM(
    'MATERIALES_RESERVADOS','EN_3Q_PENDIENTE_OC','EN_3Q',
    'RECIBIDA_PARCIAL','COMPLETADA','CANCELADA'
  ) NOT NULL DEFAULT 'MATERIALES_RESERVADOS',
  ADD COLUMN oc_vinculada_por INT UNSIGNED NULL AFTER notas,
  ADD COLUMN oc_vinculada_en DATETIME NULL AFTER oc_vinculada_por,
  ADD INDEX idx_maquila_oc_vinculada_por (oc_vinculada_por),
  ADD CONSTRAINT fk_maquila_oc_vinculada_por FOREIGN KEY (oc_vinculada_por)
    REFERENCES usuarios(id) ON DELETE RESTRICT;

ALTER TABLE kardex
  MODIFY COLUMN action ENUM(
    'INGRESO_RECEPCION','INGRESO_NOVEDAD','CONSUMO_MATERIAL','DESPACHO',
    'MERMA_PROCESO','MERMA_BODEGA','MERMA_CIERRE_WIP','DEVOLUCION',
    'PRODUCCION_PLANEADA','CIERRE_PRODUCCION','AVANCE_FASE','EXCEPCION_FIFO',
    'AJUSTE_RETORNO','SOLICITUD_RECHAZADA','AJUSTE_MANUAL','SIIGO_SYNC',
    'ENVIO_MAQUILA_3Q'
  ) NOT NULL;
