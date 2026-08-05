-- Preserve complete reference names and backfill missing reception kardex.
-- This migration does not alter stock, lot quantities or reception totals.
START TRANSACTION;

ALTER TABLE movimientos
  MODIFY COLUMN referencia_tipo VARCHAR(40) NULL;

UPDATE movimientos
SET referencia_tipo = 'recepcion_siigo_import'
WHERE referencia_tipo = 'recepcion_siigo_impo';

INSERT INTO kardex
  (id, tx_id, lot_id, product_id, user_id, action, qty, balance_after,
   reference, notes, approved_by, created_at)
SELECT
  UUID(), UUID(), l.id, grouped.producto_id, grouped.usuario_id,
  'INGRESO_RECEPCION', grouped.cantidad, l.qty_current,
  CONCAT('recepcion:', r.numero),
  CONCAT('Kardex reparado desde movimientos | Lote ', grouped.lote),
  COALESCE(r.aprobado_por, grouped.usuario_id), grouped.creado_en
FROM (
  SELECT referencia_id, producto_id, lote, usuario_id,
         SUM(cantidad) AS cantidad, MIN(creado_en) AS creado_en
  FROM movimientos
  WHERE referencia_tipo = 'recepcion_siigo_import' AND tipo = 'entrada'
  GROUP BY referencia_id, producto_id, lote, usuario_id
) grouped
JOIN recepciones r ON r.id = grouped.referencia_id
JOIN lots l ON l.lpn = grouped.lote AND l.product_id = grouped.producto_id
WHERE NOT EXISTS (
  SELECT 1 FROM kardex k
  WHERE k.lot_id = l.id
    AND k.action = 'INGRESO_RECEPCION'
    AND k.reference = CONCAT('recepcion:', r.numero)
);

UPDATE recepcion_novedades rn
SET rn.motivo = COALESCE((
  SELECT GROUP_CONCAT(DISTINCT rd.motivo ORDER BY rd.id SEPARATOR '; ')
  FROM recepcion_distribuciones rd
  WHERE rd.recepcion_id = rn.recepcion_id
    AND rd.recepcion_item_id = rn.recepcion_item_id
    AND rd.motivo IS NOT NULL AND rd.motivo <> ''
    AND (
      rd.condicion = rn.tipo
      OR (rn.tipo = 'RECHAZADO' AND rd.condicion = 'PENDIENTE_DISPOSICION')
    )
), rn.motivo)
WHERE rn.tipo IN ('CUARENTENA', 'RECHAZADO');

COMMIT;
