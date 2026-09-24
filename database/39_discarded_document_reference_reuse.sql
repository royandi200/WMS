-- Keep discarded PDF drafts for audit while allowing a corrected or repeated
-- document with the same reference to create a new reviewable draft.
ALTER TABLE documentos_bodega_borrador
  ADD COLUMN referencia_documento_activa VARCHAR(80)
    GENERATED ALWAYS AS (
      CASE WHEN estado = 'DESCARTADO' THEN NULL ELSE referencia_documento END
    ) STORED,
  DROP INDEX uk_documento_tipo_origen_referencia,
  ADD UNIQUE KEY uk_documento_tipo_origen_referencia_activa
    (tipo_documento, origen, referencia_documento_activa);
