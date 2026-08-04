-- Workflow roles. Additive and safe to run more than once.
INSERT INTO roles (nombre, descripcion)
SELECT 'recepcion_cierre', 'Recibe mercancia, documenta diferencias y cierra produccion'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(nombre) = 'recepcion_cierre');

INSERT INTO roles (nombre, descripcion)
SELECT 'alistador', 'Alista materiales, confirma lotes y registra avances de produccion'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(nombre) = 'alistador');

INSERT INTO roles (nombre, descripcion)
SELECT 'despacho', 'Confirma el despacho fisico contra facturas importadas de SIIGO'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(nombre) = 'despacho');

UPDATE roles
SET descripcion = 'Administracion y coordinacion de produccion'
WHERE LOWER(nombre) = 'admin';
