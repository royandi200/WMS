-- The client operates one physical warehouse. Quarantine is a controlled
-- location/status inside BG-PPAL, not a second receiving warehouse.
START TRANSACTION;

SET @primary_warehouse_id := (
  SELECT id FROM bodegas WHERE codigo = 'BG-PPAL' AND activa = 1 LIMIT 1
);

UPDATE ubicaciones
SET activa = 0
WHERE codigo = 'CUAR-C-1-01'
  AND bodega_id <> @primary_warehouse_id;

INSERT INTO ubicaciones
  (bodega_id, codigo, zona, pasillo, nivel, posicion, activa, creado_en)
VALUES
  (@primary_warehouse_id, 'CUAR-C-1-01', 'CUARENTENA', 'C', '1', '01', 1, NOW())
ON DUPLICATE KEY UPDATE
  zona = VALUES(zona),
  pasillo = VALUES(pasillo),
  nivel = VALUES(nivel),
  posicion = VALUES(posicion),
  activa = 1;

UPDATE system_logs
SET usuario_id = NULL
WHERE modulo = 'configuracion_bodega'
  AND mensaje = 'Cuarentena configurada como ubicacion de bodega principal';

INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
SELECT
  'configuracion_bodega',
  'INFO',
  'Cuarentena configurada como ubicacion de bodega principal',
  NULL,
  JSON_OBJECT('ubicacion', 'CUAR-C-1-01', 'bodega', 'BG-PPAL', 'migracion', '12_primary_warehouse_quarantine_location'),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM system_logs
  WHERE modulo = 'configuracion_bodega'
    AND mensaje = 'Cuarentena configurada como ubicacion de bodega principal'
);

COMMIT;
