const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  process.env.DB_HOST ||= process.env.MYSQL_HOST;
  process.env.DB_PORT ||= process.env.MYSQL_PORT;
  process.env.DB_USER ||= process.env.MYSQL_USER;
  process.env.DB_PASSWORD ||= process.env.MYSQL_PASSWORD;
  process.env.DB_NAME ||= process.env.MYSQL_DATABASE;
}

loadEnv();
const { createConnection } = require('../../api/_lib/db');
const { createCustomerReturn } = require('../../api/_lib/returns-workflow');

async function seedDispatchedItems(run) {
  const db = await createConnection();
  try {
    const [products] = await db.execute(
      `SELECT id FROM productos WHERE siigo_code = 'WMSQA260721P01' LIMIT 1`
    );
    if (!products.length) throw new Error('No existe el producto QA de devoluciones');
    const invoice = `FV-WMSRET-${run}`;
    const [inserted] = await db.execute(
      `INSERT INTO despachos
         (numero, tercero_id, cliente_nombre, bodega_id, estado, usuario_id,
          observaciones, siigo_invoice_id, siigo_invoice_name, creado_en, despachado_en)
       VALUES (?, 8, 'WMSQA260721 Cliente', 1, 'despachado', 18,
               'WMS QA return trace smoke', ?, ?, NOW(), NOW())`,
      [`DSP-WMSRET-${run}`, `WMSRET-${run}`, invoice]
    );
    for (const suffix of ['Q', 'D', 'R']) {
      await db.execute(
        `INSERT INTO despacho_items
           (despacho_id, producto_id, ubicacion_id, lote, cantidad_sol, cantidad_des)
         VALUES (?, ?, 1, ?, 1, 1)`,
        [inserted.insertId, products[0].id, `WMSRET-SOURCE-${suffix}-${run}`]
      );
    }
    return { dispatchId: inserted.insertId, invoice };
  } finally {
    await db.end();
  }
}

async function main() {
  const run = Date.now();
  const source = await seedDispatchedItems(run);
  const common = {
    id_factura: source.invoice,
    id_item: 'WMSQA260721P01',
    cantidad: 1,
    cliente_origen: 'WMSQA260721 Cliente',
  };
  const cases = [
    { key: 'Q', estado: 'CUARENTENA' },
    { key: 'D', estado: 'DESTRUCCION' },
    { key: 'R', estado: 'RECUPERABLE', ubicacion: 'PPAL-A-1-01' },
  ];
  const created = [];
  for (const item of cases) {
    created.push(await createCustomerReturn({
      ...common,
      estado: item.estado,
      lote_origen: `WMSRET-SOURCE-${item.key}-${run}`,
      referencia_devolucion: `WMSRET-${item.key}-${run}`,
      ubicacion: item.ubicacion,
    }, 18));
  }
  const retry = await createCustomerReturn({
    ...common,
    estado: 'CUARENTENA',
    lote_origen: `WMSRET-SOURCE-Q-${run}`,
    referencia_devolucion: `WMSRET-Q-${run}`,
  }, 18);

  let excessRejected = false;
  try {
    await createCustomerReturn({
      ...common,
      estado: 'CUARENTENA',
      lote_origen: `WMSRET-SOURCE-Q-${run}`,
      referencia_devolucion: `WMSRET-Q-EXCESS-${run}`,
    }, 18);
  } catch (error) {
    excessRejected = error.status === 409;
  }

  const db = await createConnection();
  try {
    const [returns] = await db.execute(
      `SELECT estado, despacho_item_id, lote, lote_origen, ubicacion_id
       FROM devoluciones WHERE despacho_id = ?`,
      [source.dispatchId]
    );
    const [stock] = await db.execute(
      `SELECT lote, cantidad, ubicacion_id FROM stock WHERE lote IN (?, ?, ?)`,
      created.map((item) => item.lote)
    );
    if (returns.length !== 3 || stock.length !== 1 || stock[0].lote !== created[2].lote) {
      throw new Error('La segregacion de inventario devuelto no es correcta');
    }
    if (!retry.already_completed || !excessRejected) {
      throw new Error('Fallaron los controles de idempotencia o cantidad maxima');
    }
    console.log(JSON.stringify({ run, source, created, retry: true, excessRejected, returns, stock }, null, 2));
  } finally {
    await db.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => { console.error(`${error.status || 'ERROR'}: ${error.message}`); process.exit(1); });
