const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { buildPurchaseOrderPdf } = require('./demo-pdf');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-creates-demo-purchase-orders';

const INPUT_ITEMS = [
  { sku: '00001-TPBI', description: 'TAPA TARRO CUADRADO BLANCO (60 UNID)', quantity: 12, unit: 'und' },
  { sku: '00006-TRP', description: 'TARRO CUADRADO x 60', quantity: 12, unit: 'und' },
  { sku: '00017-ETASH60', description: 'ETIQUETA ASHWAGANDHA x 60', quantity: 10, unit: 'und' },
  { sku: '00035-LNTP60', description: 'LINER TARRO x 60', quantity: 12, unit: 'und' },
  { sku: '00051-MPASH', description: 'GOMAS ASHWAGANDHA - MAGNESIO Y VITAMINA C', quantity: 2000, unit: 'g' },
  { sku: '00018-ETBOS60', description: 'ETIQUETA BOOSTER x 60', quantity: 10, unit: 'und' },
];
const IO_ITEMS = [
  { sku: '00276-PTZNASHWA', description: 'PRODUCTO TERMINADO ZENOVA ASHWAGANDHA', quantity: 5, unit: 'und' },
];
const OUTSOURCING_ITEMS = [
  { sku: '00105-PTBOS60', description: 'PRODUCTO TERMINADO BOOSTER X 60', quantity: 4, unit: 'und' },
];

function argument(name, fallback = '') {
  return String(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback).trim();
}

function normalizeRun(value) {
  const run = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/u.test(run)) throw new Error('Usa --run=IDENTIFICADOR con 3 a 30 letras, numeros o guiones');
  return run;
}

function loadEnvFile() {
  const candidates = [path.resolve(__dirname, '../../../.env'), path.resolve(__dirname, '../../.env')];
  const envPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!envPath) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (/^(["']).*\1$/u.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

function connectionConfig() {
  loadEnvFile();
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 15000,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

function fixtures(run, date, ioExpiry) {
  return [
    {
      key: 'inputs', number: `DEMO-${run}-OC-INSUMOS`, supplierKind: 'standard',
      title: 'ORDEN DE COMPRA - INSUMOS', purpose: 'Recepcion de materiales para produccion propia y maquila 3Q',
      items: INPUT_ITEMS,
    },
    {
      key: 'io', number: `DEMO-${run}-OC-IO`, supplierKind: 'standard',
      title: 'ORDEN DE COMPRA - PRODUCTO IN-AND-OUT', purpose: 'Recepcion directa de producto terminado sin orden de produccion',
      items: IO_ITEMS.map((item) => ({ ...item, documentLot: `DEMO-${run}-IO-ZENOVA-001`, documentExpiry: ioExpiry })),
    },
    {
      key: 'outsourcing', number: `DEMO-${run}-OC-3Q`, supplierKind: 'outsourcing',
      title: 'ORDEN DE COMPRA - MAQUILA 3Q', purpose: 'Producto terminado esperado desde maquila externa',
      items: OUTSOURCING_ITEMS,
    },
  ].map((fixture) => ({ ...fixture, date, fileName: `${fixture.number}.pdf` }));
}

async function loadContext(conn) {
  const [admins] = await conn.execute(
    `SELECT u.id, u.nombre FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) = '3174442659'
        AND LOWER(r.nombre) = 'admin' AND u.activo = 1 LIMIT 1`
  );
  if (!admins.length) throw new Error('No existe el administrador de demo');
  const [standard] = await conn.execute(
    `SELECT id, COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre FROM terceros
      WHERE tipo = 'Supplier' AND activo = 1 AND siigo_id IS NOT NULL
        AND nombre LIKE 'WMSQA260721 Proveedor%' ORDER BY id LIMIT 1`
  );
  const [outsourcing] = await conn.execute(
    `SELECT id, COALESCE(NULLIF(nombre_comercial, ''), nombre) AS nombre FROM terceros
      WHERE tipo = 'Supplier' AND activo = 1 AND siigo_id = 'DEMO-3Q-NO-SIIGO' LIMIT 1`
  );
  if (!standard.length || !outsourcing.length) throw new Error('Faltan los proveedores sinteticos del demo');
  return { admin: admins[0], standard: standard[0], outsourcing: outsourcing[0] };
}

async function loadExisting(conn, number) {
  const [rows] = await conn.execute(
    `SELECT oc.id, oc.numero, oc.estado, d.id AS documento_id, COUNT(oci.id) AS total_items
       FROM ordenes_compra_proveedor oc
       LEFT JOIN orden_compra_documentos d ON d.orden_compra_id = oc.id AND d.activo = 1
       LEFT JOIN orden_compra_proveedor_items oci ON oci.orden_compra_id = oc.id
      WHERE oc.numero = ? GROUP BY oc.id, oc.numero, oc.estado, d.id`,
    [number]
  );
  return rows[0] || null;
}

async function refreshUnusedFixture({ conn, context, fixture, run, outputDirectory }) {
  const supplier = context[fixture.supplierKind];
  await conn.beginTransaction();
  try {
    const [orders] = await conn.execute(
      `SELECT oc.id, oc.estado, oc.tercero_id, oc.datos_origen
         FROM ordenes_compra_proveedor oc WHERE oc.numero = ? LIMIT 1 FOR UPDATE`,
      [fixture.number]
    );
    if (!orders.length) {
      await conn.rollback();
      return null;
    }
    const order = orders[0];
    let source = order.datos_origen && typeof order.datos_origen === 'object'
      ? order.datos_origen
      : {};
    if (typeof order.datos_origen === 'string') {
      try { source = JSON.parse(order.datos_origen || '{}'); } catch { source = {}; }
    }
    if (order.estado !== 'CARGADA' || Number(order.tercero_id) !== Number(supplier.id)
        || source.demo !== true || source.run !== run) {
      throw new Error(`La OC ${fixture.number} no es un fixture sin usar de esta corrida`);
    }
    const [references] = await conn.execute(
      `SELECT
         EXISTS(SELECT 1 FROM recepciones WHERE orden_compra_id = ?) AS recepciones,
         EXISTS(SELECT 1 FROM ordenes_maquila WHERE orden_compra_id = ?) AS maquila`,
      [order.id, order.id]
    );
    if (Number(references[0].recepciones) || Number(references[0].maquila)) {
      throw new Error(`La OC ${fixture.number} ya tiene operaciones y no puede refrescarse`);
    }
    const [storedItems] = await conn.execute(
      `SELECT oci.id, p.siigo_code AS sku
         FROM orden_compra_proveedor_items oci
         JOIN productos p ON p.id = oci.producto_id
        WHERE oci.orden_compra_id = ? ORDER BY oci.id FOR UPDATE`,
      [order.id]
    );
    const bySku = new Map(storedItems.map((item) => [item.sku, item.id]));
    if (storedItems.length !== fixture.items.length || fixture.items.some((item) => !bySku.has(item.sku))) {
      throw new Error(`Los items de ${fixture.number} no coinciden con el fixture`);
    }
    const pdf = buildPurchaseOrderPdf({
      number: fixture.number, supplier: supplier.nombre, date: fixture.date,
      title: fixture.title, purpose: fixture.purpose, items: fixture.items,
    });
    const filePath = path.join(outputDirectory, fixture.fileName);
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(filePath, pdf);
    const { normalizePurchaseOrderInput } = require('../../api/_lib/purchase-orders');
    const normalized = normalizePurchaseOrderInput({
      numero: fixture.number,
      tercero_id: supplier.id,
      fecha_orden: fixture.date,
      items: fixture.items.map((item) => ({
        sku: item.sku, cantidad: item.quantity, unidad: item.unit,
        descripcion: item.description, lote_documento: item.documentLot,
        fecha_vencimiento_documento: item.documentExpiry,
      })),
    });
    const documentHash = crypto.createHash('sha256').update(pdf).digest('hex');
    for (const item of fixture.items) {
      await conn.execute(
        `UPDATE orden_compra_proveedor_items
            SET lote_documento = ?, fecha_vencimiento_documento = ? WHERE id = ?`,
        [item.documentLot || null, item.documentExpiry || null, bySku.get(item.sku)]
      );
    }
    await conn.execute(
      `UPDATE ordenes_compra_proveedor
          SET archivo_nombre = ?, archivo_hash = ?, datos_origen = ?, actualizado_en = NOW()
        WHERE id = ?`,
      [fixture.fileName, normalized.hash,
       JSON.stringify({ demo: true, run, external_system: false, purpose: fixture.key }), order.id]
    );
    const [updatedDocument] = await conn.execute(
      `UPDATE orden_compra_documentos
          SET nombre_original = ?, mime_type = 'application/pdf', tamano_bytes = ?,
              sha256 = ?, contenido = ?
        WHERE orden_compra_id = ? AND activo = 1`,
      [fixture.fileName, pdf.length, documentHash, pdf, order.id]
    );
    if (updatedDocument.affectedRows !== 1) throw new Error(`El PDF de ${fixture.number} no es unico`);
    await conn.commit();
    return { number: fixture.number, refreshed: true };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  }
}

async function createFixture({ conn, context, fixture, run, outputDirectory }) {
  const supplier = context[fixture.supplierKind];
  const pdf = buildPurchaseOrderPdf({
    number: fixture.number,
    supplier: supplier.nombre,
    date: fixture.date,
    title: fixture.title,
    purpose: fixture.purpose,
    items: fixture.items,
  });
  const filePath = path.join(outputDirectory, fixture.fileName);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(filePath, pdf);
  const { createPurchaseOrderForUser } = require('../../api/v1/purchase-orders');
  const result = await createPurchaseOrderForUser({
    user: { id: context.admin.id, rol: 'admin' },
    body: {
      numero: fixture.number,
      tercero_id: supplier.id,
      fecha_orden: fixture.date,
      archivo_nombre: fixture.fileName,
      datos_origen: { demo: true, run, external_system: false, purpose: fixture.key },
      documento_pdf: { nombre: fixture.fileName, mime_type: 'application/pdf', base64: pdf.toString('base64') },
      items: fixture.items.map((item) => ({
        sku: item.sku,
        cantidad: item.quantity,
        unidad: item.unit,
        descripcion: item.description,
        lote_documento: item.documentLot,
        fecha_vencimiento_documento: item.documentExpiry,
      })),
    },
  });
  const stored = await loadExisting(conn, fixture.number);
  if (!stored || !stored.documento_id || Number(stored.total_items) !== fixture.items.length) {
    throw new Error(`La OC ${fixture.number} no quedo completa`);
  }
  return { key: fixture.key, ...stored, pdf: filePath, duplicate: Boolean(result.data?.duplicate) };
}

async function main() {
  const run = normalizeRun(argument('run'));
  const date = argument('date', '2026-09-03');
  const ioExpiry = argument('io-expiry', '2027-11-29');
  const only = argument('only', 'all').toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error('Usa --date=YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(ioExpiry)) throw new Error('Usa --io-expiry=YYYY-MM-DD');
  if (!['all', 'inputs', 'io', 'outsourcing'].includes(only)) throw new Error('Usa --only=all|inputs|io|outsourcing');
  const apply = process.argv.includes(APPLY_FLAG);
  const pdfOnly = process.argv.includes('--pdf-only');
  if (apply && pdfOnly) throw new Error('--apply y --pdf-only son excluyentes');
  if (apply && !process.argv.includes(CONFIRM_FLAG)) throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const context = await loadContext(conn);
    const planned = fixtures(run, date, ioExpiry);
    const current = [];
    for (const fixture of planned) current.push({ ...fixture, existing: await loadExisting(conn, fixture.number) });
    if (pdfOnly) {
      const selected = only === 'all' ? planned : planned.filter((fixture) => fixture.key === only);
      const outputDirectory = path.resolve(__dirname, `../../output/pdf/demo-${run.toLowerCase()}`);
      fs.mkdirSync(outputDirectory, { recursive: true });
      const files = selected.map((fixture) => {
        const supplier = context[fixture.supplierKind];
        const pdf = buildPurchaseOrderPdf({
          number: fixture.number, supplier: supplier.nombre, date: fixture.date,
          title: fixture.title, purpose: fixture.purpose, items: fixture.items,
        });
        const filePath = path.join(outputDirectory, fixture.fileName);
        fs.writeFileSync(filePath, pdf);
        return { key: fixture.key, number: fixture.number, file: filePath, sha256: crypto.createHash('sha256').update(pdf).digest('hex') };
      });
      console.log(JSON.stringify({ ok: true, mode: 'pdf-only', run, databaseChanged: false, files }, null, 2));
      return;
    }
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', run, date, current }, null, 2));
      return;
    }
    const outputDirectory = path.resolve(__dirname, `../../output/pdf/demo-${run.toLowerCase()}`);
    const refreshed = [];
    if (process.argv.includes('--refresh-unused')) {
      for (const fixture of planned) {
        const result = await refreshUnusedFixture({ conn, context, fixture, run, outputDirectory });
        if (result) refreshed.push(result);
      }
    }
    const created = [];
    for (const fixture of planned) created.push(await createFixture({ conn, context, fixture, run, outputDirectory }));
    console.log(JSON.stringify({
      ok: true,
      mode: 'applied',
      run,
      date,
      ioExpiry,
      refreshed,
      purchaseOrders: created,
      lotNames: {
        inputGummies: `DEMO-${run}-GOMAS-001`,
        inAndOut: `DEMO-${run}-IO-ZENOVA-001`,
        outsourcingFirst: `3Q-${run}-BOOSTER-A`,
        outsourcingSecond: `3Q-${run}-BOOSTER-B`,
      },
    }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
