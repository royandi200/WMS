-- Keep the business disposition in devoluciones.estado and use only physical
-- states supported by the current lots.status enum.
UPDATE lots l
JOIN devoluciones d ON d.lote = l.lpn
SET l.status = CASE UPPER(d.estado)
  WHEN 'RECUPERABLE' THEN 'DISPONIBLE'
  WHEN 'CUARENTENA' THEN 'CUARENTENA'
  ELSE 'PENDIENTE_DISPOSICION'
END
WHERE l.origin = 'DEVOLUCION'
  AND COALESCE(l.status, '') <> CASE UPPER(d.estado)
    WHEN 'RECUPERABLE' THEN 'DISPONIBLE'
    WHEN 'CUARENTENA' THEN 'CUARENTENA'
    ELSE 'PENDIENTE_DISPOSICION'
  END;
