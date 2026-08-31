const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DATA_PATH = path.join(__dirname, '..', 'database', 'acta_5_2_master_data.json');
const BACKUP_SUFFIX = '20260826';
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-replaces-bom';

// Referencias vigentes del acta que pertenecen al flujo de embalaje y no al BOM 5.2.
// Algunas aun no existen en el catalogo; se reservan para que una recarga no las desactive.
const ACTA_CODES_OUTSIDE_5_2 = Object.freeze([
  '00038-CJ12',
  '00038-CJ12IN',
  '00040-CMV',
  '00041-CMCV',
  '00042-CMCG',
  '00283-TPDCJM',
  '00284-SEP',
  '00285-ESQ',
  '00288-VINI',
]);

const FALLBACK_NAMES = {
  '000-MPMENT': 'MATERIA PRIMA MENTALIS',
  '00015-ETRESI60': 'ETIQUETA RESVERATROL X 60',
  '000293-ETLBRES': 'ETIQUETA RESVERATROL LINEA BLANCA',
  '001-SAMPVIN': 'BOLSA SAMPLING VINAGRE',
  '002-SAMCALV': 'BOLSA SAMPLING CALM VIBES',
  '00286-PTCOLV': '00286-PTCOLV',
  '00287-PTVV': '00287-PTVV',
  '00286-SAMPV': '00286-SAMPV',
  '00287-SAMPCV': '00287-SAMPCV',
};

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) &&
      (process.env.DB_USER || process.env.MYSQL_USER) &&
      (process.env.DB_NAME || process.env.MYSQL_DATABASE)) return;
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function readDataset() {
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function canonicalize(dataset) {
  const rows = dataset.rows || [];
  if (!rows.length) throw new Error('La seccion 5.2 no contiene filas');

  const modes = new Map();
  const unitsByCode = new Map();
  const uniquePairs = new Map();
  const duplicates = [];

  for (const row of rows) {
    if (!row.producto || !row.insumo) throw new Error(`Fila ${row.source_row}: codigo faltante`);
    if (!['PR', 'PT', 'IO'].includes(row.modalidad)) {
      throw new Error(`Fila ${row.source_row}: modalidad invalida`);
    }
    if (!Number.isFinite(row.cantidad) || row.cantidad <= 0) {
      throw new Error(`Fila ${row.source_row}: cantidad invalida`);
    }
    if (!['und', 'g'].includes(row.unidad)) {
      throw new Error(`Fila ${row.source_row}: unidad invalida ${row.unidad}`);
    }
    if (row.modalidad === 'PR' && row.etapa !== 'PRODUCCION') {
      throw new Error(`Fila ${row.source_row}: PR debe usar etapa PRODUCCION`);
    }
    if (row.modalidad === 'PT' && row.etapa !== 'ENVIO') {
      throw new Error(`Fila ${row.source_row}: PT debe usar etapa ENVIO`);
    }
    if (row.modalidad === 'IO' && row.producto !== row.insumo) {
      throw new Error(`Fila ${row.source_row}: IO debe ser autorreferenciada`);
    }

    const previousMode = modes.get(row.producto);
    if (previousMode && previousMode !== row.modalidad) {
      throw new Error(`${row.producto} tiene modalidades incompatibles`);
    }
    modes.set(row.producto, row.modalidad);

    if (row.modalidad !== 'IO') {
      const previousUnit = unitsByCode.get(row.insumo);
      if (previousUnit && previousUnit !== row.unidad) {
        throw new Error(`${row.insumo} aparece con unidades incompatibles`);
      }
      unitsByCode.set(row.insumo, row.unidad);

      const pair = `${row.producto}|${row.insumo}`;
      if (uniquePairs.has(pair)) {
        const first = uniquePairs.get(pair);
        if (first.cantidad !== row.cantidad || first.unidad !== row.unidad || first.etapa !== row.etapa) {
          throw new Error(`Duplicado conflictivo ${pair}`);
        }
        duplicates.push({ pair, kept_row: first.source_row, ignored_row: row.source_row });
      } else {
        uniquePairs.set(pair, row);
      }
    }
  }

  const products = new Map();
  for (const [code, mode] of modes) {
    products.set(code, {
      code,
      mode,
      unit: 'und',
      requiresLot: true,
      isFinishedProduct: true,
    });
  }
  for (const [code, unit] of unitsByCode) {
    if (!products.has(code)) {
      products.set(code, {
        code,
        mode: null,
        unit,
        requiresLot: unit === 'g',
        isFinishedProduct: false,
      });
    }
  }

  const modeCounts = { PR: 0, PT: 0, IO: 0 };
  for (const mode of modes.values()) modeCounts[mode] += 1;
  return {
    rows,
    products: [...products.values()],
    bomRows: [...uniquePairs.values()],
    modes,
    modeCounts,
    duplicates,
  };
}

function connectionConfig() {
  const values = {
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`Faltan variables de base de datos: ${missing.join(', ')}`);
  return {
    host: values.host,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: values.user,
    password: values.password,
    database: values.database,
    connectTimeout: 15000,
    timezone: process.env.DB_TIMEZONE || '-05:00',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, index) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function triggerExists(conn, trigger) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM information_schema.triggers
     WHERE trigger_schema = DATABASE() AND trigger_name = ? LIMIT 1`,
    [trigger]
  );
  return rows.length > 0;
}

async function ensureSchema(conn) {
  if (!(await columnExists(conn, 'productos', 'modalidad_operativa'))) {
    await conn.query(
      `ALTER TABLE productos
       ADD COLUMN modalidad_operativa ENUM('PR','PT','IO') NULL AFTER tipo_producto`
    );
  }
  if (!(await indexExists(conn, 'productos', 'idx_productos_modalidad_operativa'))) {
    await conn.query('CREATE INDEX idx_productos_modalidad_operativa ON productos (modalidad_operativa)');
  }
  if (!(await columnExists(conn, 'bom', 'etapa'))) {
    await conn.query(
      `ALTER TABLE bom
       ADD COLUMN etapa ENUM('PRODUCCION','ENVIO') NOT NULL DEFAULT 'PRODUCCION' AFTER unidad`
    );
  }
  if (!(await triggerExists(conn, 'trg_op_modalidad_insert'))) {
    await conn.query(
      `CREATE TRIGGER trg_op_modalidad_insert
       BEFORE INSERT ON ordenes_produccion FOR EACH ROW
       BEGIN
         DECLARE v_modalidad VARCHAR(2);
         SELECT modalidad_operativa INTO v_modalidad FROM productos WHERE id = NEW.producto_id;
         IF COALESCE(v_modalidad, '') <> 'PR' THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'Solo productos PR pueden crear ordenes de produccion interna';
         END IF;
       END`
    );
  }
  if (!(await triggerExists(conn, 'trg_op_modalidad_product_update'))) {
    await conn.query(
      `CREATE TRIGGER trg_op_modalidad_product_update
       BEFORE UPDATE ON ordenes_produccion FOR EACH ROW
       BEGIN
         DECLARE v_modalidad VARCHAR(2);
         IF NOT (NEW.producto_id <=> OLD.producto_id) THEN
           SELECT modalidad_operativa INTO v_modalidad FROM productos WHERE id = NEW.producto_id;
           IF COALESCE(v_modalidad, '') <> 'PR' THEN
             SIGNAL SQLSTATE '45000'
               SET MESSAGE_TEXT = 'Solo productos PR pueden asignarse a produccion interna';
           END IF;
         END IF;
       END`
    );
  }
}

async function createBackups(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS backup_productos_pre_acta_${BACKUP_SUFFIX} LIKE productos`);
  await conn.query(`INSERT IGNORE INTO backup_productos_pre_acta_${BACKUP_SUFFIX} SELECT * FROM productos`);
  await conn.query(`CREATE TABLE IF NOT EXISTS backup_skus_pre_acta_${BACKUP_SUFFIX} LIKE skus`);
  await conn.query(`INSERT IGNORE INTO backup_skus_pre_acta_${BACKUP_SUFFIX} SELECT * FROM skus`);
  await conn.query(`CREATE TABLE IF NOT EXISTS backup_bom_pre_acta_${BACKUP_SUFFIX} LIKE bom`);
  await conn.query(`INSERT IGNORE INTO backup_bom_pre_acta_${BACKUP_SUFFIX} SELECT * FROM bom`);
}

function retainedActaCodes(canonical) {
  return new Set([
    ...canonical.products.map(product => product.code),
    ...ACTA_CODES_OUTSIDE_5_2,
  ]);
}

async function applyDataset(conn, canonical, dataset) {
  const [existingRows] = await conn.query(
    'SELECT id, siigo_code, nombre FROM productos ORDER BY id FOR UPDATE'
  );
  const existingByCode = new Map(existingRows.map(row => [row.siigo_code, row]));
  const retainedCodes = retainedActaCodes(canonical);
  let deactivatedProducts = 0;

  for (const existing of existingRows) {
    if (!retainedCodes.has(existing.siigo_code)) {
      const [deactivation] = await conn.execute(
        `UPDATE productos
         SET activo = 0, modalidad_operativa = NULL, actualizado_en = NOW()
         WHERE id = ?`,
        [existing.id]
      );
      deactivatedProducts += Number(deactivation.affectedRows || 0);
    }
  }

  // SKU aliases are lookup data, not inventory history. Keeping aliases for inactive
  // products makes obsolete references searchable even though the product is disabled.
  const [skuCleanup] = await conn.query(
    `DELETE s FROM skus s
     INNER JOIN productos p ON p.id = s.producto_id
     WHERE p.activo = 0`
  );

  for (const product of canonical.products) {
    const existing = existingByCode.get(product.code);
    const name = existing?.nombre || FALLBACK_NAMES[product.code] || product.code;
    await conn.execute(
      `INSERT INTO productos
         (siigo_code, nombre, descripcion, tipo_producto, modalidad_operativa,
          control_stock, activo, requiere_lote, requiere_serial, unit_label,
          referencia, stock_minimo, stock_maximo, creado_en, actualizado_en)
       VALUES (?, ?, ?, 'Product', ?, 1, 1, ?, 0, ?, ?, 0, 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         modalidad_operativa = VALUES(modalidad_operativa),
         control_stock = 1,
         activo = 1,
         requiere_lote = VALUES(requiere_lote),
         unit_label = VALUES(unit_label),
         referencia = VALUES(referencia),
         descripcion = VALUES(descripcion),
         actualizado_en = NOW()`,
      [
        product.code,
        name,
        `Fuente: ${dataset.source.document}, seccion ${dataset.source.section}`,
        product.mode,
        product.requiresLot ? 1 : 0,
        product.unit,
        product.code,
      ]
    );
  }

  const [resolvedProducts] = await conn.query(
    'SELECT id, siigo_code, nombre FROM productos ORDER BY id'
  );
  const productByCode = new Map(resolvedProducts.map(row => [row.siigo_code, row]));
  for (const product of canonical.products) {
    const resolved = productByCode.get(product.code);
    if (!resolved) throw new Error(`No se pudo resolver ${product.code}`);
    await conn.execute(
      `INSERT INTO skus
         (producto_id, sku, tipo, descripcion, unidad, factor_conv, activo, notas)
       VALUES (?, ?, 'PRINCIPAL', ?, ?, 1, 1, ?)
       ON DUPLICATE KEY UPDATE
         producto_id = VALUES(producto_id),
         tipo = 'PRINCIPAL',
         descripcion = VALUES(descripcion),
         unidad = VALUES(unidad),
         activo = 1,
         notas = VALUES(notas),
         actualizado_en = NOW()`,
      [resolved.id, product.code, resolved.nombre, product.unit, 'Fuente acta 5.2']
    );
  }

  await conn.query('DELETE FROM bom');
  for (const row of canonical.bomRows) {
    const finalProduct = productByCode.get(row.producto);
    const input = productByCode.get(row.insumo);
    if (!finalProduct || !input) throw new Error(`No se pudo resolver BOM fila ${row.source_row}`);
    await conn.execute(
      `INSERT INTO bom
         (producto_final_id, insumo_id, cantidad_por_unidad, unidad, etapa, notas)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        finalProduct.id,
        input.id,
        row.cantidad,
        row.unidad,
        row.etapa,
        `Acta 5.2 fila ${row.source_row}: ${row.observacion || ''}`.slice(0, 200),
      ]
    );
  }
  return {
    deactivated_products: deactivatedProducts,
    removed_skus: Number(skuCleanup.affectedRows || 0),
  };
}

async function verifyApplied(conn, canonical) {
  const [modeRows] = await conn.query(
    `SELECT modalidad_operativa AS modalidad, COUNT(*) AS cantidad
     FROM productos WHERE modalidad_operativa IS NOT NULL
     GROUP BY modalidad_operativa ORDER BY modalidad_operativa`
  );
  const actualModes = Object.fromEntries(modeRows.map(row => [row.modalidad, Number(row.cantidad)]));
  for (const mode of ['PR', 'PT', 'IO']) {
    if ((actualModes[mode] || 0) !== canonical.modeCounts[mode]) {
      throw new Error(`Conteo ${mode} inesperado: ${actualModes[mode] || 0}`);
    }
  }

  const [[bomCount]] = await conn.query('SELECT COUNT(*) AS cantidad FROM bom');
  if (Number(bomCount.cantidad) !== canonical.bomRows.length) {
    throw new Error(`Conteo BOM inesperado: ${bomCount.cantidad}`);
  }
  const [[ioBom]] = await conn.query(
    `SELECT COUNT(*) AS cantidad FROM bom b
     JOIN productos p ON p.id = b.producto_final_id
     WHERE p.modalidad_operativa = 'IO'`
  );
  if (Number(ioBom.cantidad) !== 0) throw new Error('Un producto IO quedo con BOM');
  const [[wrongStage]] = await conn.query(
    `SELECT COUNT(*) AS cantidad FROM bom b
     JOIN productos p ON p.id = b.producto_final_id
     WHERE (p.modalidad_operativa = 'PR' AND b.etapa <> 'PRODUCCION')
        OR (p.modalidad_operativa = 'PT' AND b.etapa <> 'ENVIO')
        OR p.modalidad_operativa IS NULL`
  );
  if (Number(wrongStage.cantidad) !== 0) throw new Error('Hay BOM con modalidad o etapa incompatible');
  const [[inactiveProductSkus]] = await conn.query(
    `SELECT COUNT(*) AS cantidad
     FROM skus s
     INNER JOIN productos p ON p.id = s.producto_id
     WHERE p.activo = 0`
  );
  if (Number(inactiveProductSkus.cantidad) !== 0) {
    throw new Error('Quedaron SKU asociados a productos inactivos');
  }
  const canonicalCodes = canonical.products.map(product => product.code);
  const placeholders = canonicalCodes.map(() => '?').join(', ');
  const [[missingCanonicalSkus]] = await conn.query(
    `SELECT COUNT(*) AS cantidad
     FROM productos p
     LEFT JOIN skus s
       ON s.producto_id = p.id
      AND s.sku = p.siigo_code
      AND s.tipo = 'PRINCIPAL'
      AND s.activo = 1
     WHERE p.siigo_code IN (${placeholders})
       AND s.id IS NULL`,
    canonicalCodes
  );
  if (Number(missingCanonicalSkus.cantidad) !== 0) {
    throw new Error('Falta el SKU principal de una referencia vigente del acta');
  }
  const retainedCodes = [...retainedActaCodes(canonical)];
  const retainedPlaceholders = retainedCodes.map(() => '?').join(', ');
  const [[unexpectedActiveProducts]] = await conn.query(
    `SELECT COUNT(*) AS cantidad
     FROM productos
     WHERE activo = 1
       AND siigo_code NOT IN (${retainedPlaceholders})`,
    retainedCodes
  );
  if (Number(unexpectedActiveProducts.cantidad) !== 0) {
    throw new Error('Quedaron referencias activas que no pertenecen al acta vigente');
  }
  return {
    modes: actualModes,
    bom_rows: Number(bomCount.cantidad),
    io_bom_rows: 0,
    inactive_product_skus: 0,
    missing_canonical_skus: 0,
    unexpected_active_products: 0,
  };
}

async function main() {
  const dataset = readDataset();
  const canonical = canonicalize(dataset);
  const apply = process.argv.includes(APPLY_FLAG);
  const confirmed = process.argv.includes(CONFIRM_FLAG);
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    source_rows: canonical.rows.length,
    products: canonical.products.length,
    finished_products: canonical.modes.size,
    mode_counts: canonical.modeCounts,
    bom_rows: canonical.bomRows.length,
    duplicate_rows_ignored: canonical.duplicates,
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!confirmed) {
    throw new Error(`La carga real requiere ${CONFIRM_FLAG}`);
  }

  loadEnvFile();
  const conn = await mysql.createConnection(connectionConfig());
  let lockAcquired = false;
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('wms_acta_5_2_import', 10) AS acquired");
    lockAcquired = Number(lock.acquired) === 1;
    if (!lockAcquired) throw new Error('No se pudo adquirir el bloqueo de importacion');

    await ensureSchema(conn);
    await createBackups(conn);
    await conn.beginTransaction();
    try {
      const changes = await applyDataset(conn, canonical, dataset);
      const verification = await verifyApplied(conn, canonical);
      await conn.commit();
      console.log(JSON.stringify({ ...summary, changes, verification, committed: true }, null, 2));
    } catch (error) {
      await conn.rollback();
      throw error;
    }
  } finally {
    if (lockAcquired) await conn.query("SELECT RELEASE_LOCK('wms_acta_5_2_import')").catch(() => {});
    await conn.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[acta-5.2] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { ACTA_CODES_OUTSIDE_5_2, canonicalize, readDataset, retainedActaCodes };
