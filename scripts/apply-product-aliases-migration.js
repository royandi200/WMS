const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { normalizeProductReference } = require('../api/_lib/product-references');

const MIGRATION_PATH = path.join(__dirname, '..', 'database', '22_product_aliases.sql');
const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-changes-the-qa-schema';

const DOCUMENTED_ALIASES = Object.freeze({
  '00001-TPBI': ['tapa blanca 60', 'tapa tarro 60'],
  '00004-TPALB': ['tapa azul ashwagandha linea blanca 60'],
  '00005-TPMLB': ['tapa morada resveratrol linea blanca 60'],
  '00006-TRP': ['tarro 60', 'tarro cuadrado 60', 'tarro pequeno'],
  '00017-ETASH60': ['etiqueta ashwagandha 60', 'etiqueta ashwa 60'],
  '00035-LNTP60': ['liner 60', 'liner tarro 60'],
  '00038-CJ56': ['caja 56', 'cajas 56'],
  '00040-CMV': ['caja master vinagre', 'caja master vinagre 24'],
  '00041-CMCV': ['caja master calm vibes', 'caja master calm vibes 24'],
  '00042-CMCG': ['caja master creagums', 'caja master creagums 24'],
  '00043-BECM': ['bolsa ecommerce', 'bolsa empaque ecommerce'],
  '00044-MPCBR': ['gomas colageno biotina rojas'],
  '00045-MPASHLB': ['gomas ashwagandha linea blanca', 'gomas ashwa linea blanca'],
  '00046-MPRESLB': ['gomas resveratrol linea blanca'],
  '00047-MPCBCT': ['gomas calm vibes', 'gomas calm teddys'],
  '00048-MPGF': ['gomas green fit'],
  '00049-MPVM': ['gomas vinagre de manzana', 'gomas vinagre'],
  '00050-MPRO': ['gomas probioticos'],
  '00051-MPASH': ['gomas ashwagandha', 'gomas ashwa'],
  '00052-MPCG': ['gomas creagums'],
  '00053-MPCLP': ['gomas colageno lilipink'],
  '00100-MPGT': ['gomas green teddys'],
  '00101-PTMCL60': ['menocalm 60'],
  '00102-PTASH60': ['ashwagandha 60', 'ashwa 60'],
  '00103-PTAUR': ['aura fresh', 'aura soul', 'aura serenity', 'aura rose love'],
  '00104-PTBLNC60': ['balance 60'],
  '00105-PTBOS60': ['booster 60'],
  '00106-PTCLT60': ['calm teddys 60'],
  '00106-PTCV60': ['calm vibes 60'],
  '00108-PTCBS60': ['coffee booster 60'],
  '00109-PTCOL60': ['colageno biotina 60'],
  '00110-PTCG120': ['creagums 120'],
  '00111-PTFUN': ['fungi cafe'],
  '00112-PTGT60': ['gargantox 60'],
  '00113-PTGES60': ['gestar 60'],
  '00114-PTGF60': ['green fit 60'],
  '00116-PTH&N60': ['hair vitamins 60'],
  '00117-PTMGF60': ['megfull 60'],
  '00118-PTMTLS60': ['mentalis 60'],
  '00120-PTPBT60': ['probioticos 60'],
  '00121-PTPG60': ['pro g 60'],
  '00123-PTSLW60': ['solar low 60'],
  '00125-PTVM60': ['vinagre de manzana 60', 'vinagre 60'],
  '00126-PTLUM': ['lumia multiestilizador', 'lumia'],
  '00200-PTASH120': ['ashwagandha 120', 'ashwa 120'],
  '00201-PTPBS120': ['probioticos 120'],
  '00202-PTGT60': ['green teddys 60'],
  '00202-PTRESV120': ['resveratrol 120'],
  '00203-PTMTL120': ['mentalis 120'],
  '00204-PTVM120': ['vinagre de manzana 120', 'vinagre 120'],
  '00205-PTCV120': ['calm vibes 120'],
  '00206-PTCG140': ['creagums 140'],
  '00207-PTAHSLB': ['ashwagandha linea blanca', 'ashwa linea blanca'],
  '00208-PTRESVLB': ['resveratrol linea blanca'],
  '00231-PTRES60': ['resveratrol 60'],
  '00276-PTZNASHWA': ['zenova ashwagandha', 'zenova ashwa'],
  '00277-PTZNREM': ['zenova remolacha'],
  '00278-PTZNCUR': ['zenova curcuma'],
  '00279-PTZNINO': ['zenova inositol'],
  '00280-PTZNQUE': ['zenova queen'],
  '00281-PTZNMAG': ['zenova magnesio'],
});

function loadEnvFile() {
  if ((process.env.DB_HOST || process.env.MYSQL_HOST) && (process.env.DB_USER || process.env.MYSQL_USER)) return;
  const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function connectionConfig() {
  loadEnvFile();
  return {
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

function shortProductAlias(name) {
  return String(name || '')
    .replace(/^PRODUCTO\s+TERMINADO\s+/i, '')
    .replace(/\bTARRO\b/gi, ' ')
    .replace(/\bX\s*(\d+)/gi, '$1')
    .replace(/\b(\d+)\s*G\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function inspect(conn) {
  const [[table]] = await conn.execute(
    `SELECT COUNT(*) AS cantidad FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'producto_aliases'`
  );
  if (!Number(table.cantidad)) return { table: false, aliases: 0, products: 0 };
  const [[counts]] = await conn.execute(
    `SELECT COUNT(*) AS aliases, COUNT(DISTINCT producto_id) AS products
       FROM producto_aliases WHERE activo = 1`
  );
  return { table: true, aliases: Number(counts.aliases), products: Number(counts.products) };
}

async function seedAliases(conn) {
  const [products] = await conn.execute(
    `SELECT id, siigo_code, nombre, modalidad_operativa FROM productos WHERE activo = 1 ORDER BY id`
  );
  let written = 0;
  for (const product of products) {
    const aliases = [{ value: product.nombre, origin: 'NOMBRE_OFICIAL' }];
    if (product.modalidad_operativa) {
      aliases.push({ value: shortProductAlias(product.nombre), origin: 'SISTEMA' });
    }
    for (const alias of DOCUMENTED_ALIASES[product.siigo_code] || []) {
      aliases.push({ value: alias, origin: 'SISTEMA' });
    }
    const unique = new Map();
    for (const alias of aliases) {
      const normalized = normalizeProductReference(alias.value);
      if (normalized) unique.set(normalized, { ...alias, normalized });
    }
    for (const alias of unique.values()) {
      const [result] = await conn.execute(
        `INSERT INTO producto_aliases
           (producto_id, alias, alias_normalizado, origen, activo, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           alias = VALUES(alias),
           origen = IF(origen = 'CLIENTE', origen, VALUES(origen)),
           activo = 1,
           actualizado_en = NOW()`,
        [product.id, alias.value, alias.normalized, alias.origin]
      );
      written += Number(result.affectedRows || 0) > 0 ? 1 : 0;
    }
  }
  return { products: products.length, written };
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const before = await inspect(conn);
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', before, documented_aliases: DOCUMENTED_ALIASES }, null, 2));
      return;
    }
    await conn.query(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    await conn.beginTransaction();
    const seeded = await seedAliases(conn);
    await conn.commit();
    const after = await inspect(conn);
    if (!after.table || after.products !== seeded.products) throw new Error('El catalogo de alias no cubre todos los productos activos');
    console.log(JSON.stringify({ ok: true, mode: 'applied', before, seeded, after }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
