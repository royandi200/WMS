const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const APPLY_FLAG = '--apply';
const CONFIRM_FLAG = '--yes-i-understand-this-creates-demo-master-data';
const ADMIN_PHONE = '3174442659';
const ROTATING_PHONE = '3125031367';
const INPUT_ORDER_NUMBER = 'DEMO-20260902-OC-INSUMOS';
const IO_ORDER_NUMBER = 'DEMO-20260902-DOC-IO-001';
const OUTSOURCING_ORDER_NUMBER = 'DEMO-20260902-OC-3Q-001';
const OUTSOURCING_SKU = '00105-PTBOS60';
const OUTSOURCING_QUANTITY = 4;
const OWN_SKU = '00102-PTASH60';
const OWN_QUANTITY = 3;
const DEMO_SUPPLIER = Object.freeze({
  siigoId: 'DEMO-3Q-NO-SIIGO',
  identification: '900000003',
  name: '3Q - PROVEEDOR DEMO',
});
const PDF_PATH = path.resolve(__dirname, '../../output/pdf/DEMO-20260902-OC-3Q-001.pdf');

function loadEnvFile() {
  const candidates = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env'),
  ];
  const envPath = candidates.find(candidate => fs.existsSync(candidate));
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
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    connectTimeout: 15000,
    ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/gu, '').slice(-10);
}

async function loadUsers(conn) {
  const [rows] = await conn.execute(
    `SELECT u.id, u.nombre, u.telefono, LOWER(r.nombre) AS rol
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
      WHERE u.activo = 1
        AND RIGHT(REGEXP_REPLACE(COALESCE(u.telefono, ''), '[^0-9]', ''), 10) IN (?, ?)
      ORDER BY u.id`,
    [ADMIN_PHONE, ROTATING_PHONE]
  );
  const byPhone = new Map(rows.map(row => [normalizePhone(row.telefono), row]));
  const admin = byPhone.get(ADMIN_PHONE);
  const rotating = byPhone.get(ROTATING_PHONE);
  if (!admin || admin.rol !== 'admin') throw new Error('La linea de Juan no tiene rol admin');
  if (!rotating) throw new Error('La linea rotativa no identifica un usuario activo');
  return { admin, rotating };
}

async function loadSupplier(conn) {
  const [rows] = await conn.execute(
    `SELECT id, siigo_id, identification, nombre, tipo, activo, comentarios
       FROM terceros WHERE siigo_id = ? OR identification = ? ORDER BY id`,
    [DEMO_SUPPLIER.siigoId, DEMO_SUPPLIER.identification]
  );
  if (rows.length > 1) throw new Error('La identidad demo 3Q no es unica');
  if (!rows.length) return null;
  const supplier = rows[0];
  if (supplier.siigo_id !== DEMO_SUPPLIER.siigoId
      || supplier.identification !== DEMO_SUPPLIER.identification
      || supplier.nombre !== DEMO_SUPPLIER.name
      || supplier.tipo !== 'Supplier'
      || !Number(supplier.activo)) {
    throw new Error('El proveedor demo 3Q existe con datos diferentes');
  }
  return supplier;
}

async function ensureSupplier(conn, adminId) {
  const existing = await loadSupplier(conn);
  if (existing) return { ...existing, duplicate: true };
  const [created] = await conn.execute(
    `INSERT INTO terceros
       (siigo_id, tipo, person_type, id_type, identification, check_digit,
        nombre, nombre_comercial, branch_office, activo, comentarios,
        creado_en, actualizado_en)
     VALUES (?, 'Supplier', 'company', '31', ?, '0', ?, ?, 0, 1, ?, NOW(), NOW())`,
    [DEMO_SUPPLIER.siigoId, DEMO_SUPPLIER.identification, DEMO_SUPPLIER.name,
     DEMO_SUPPLIER.name,
     `Fixture controlado de demo creado por usuario ${adminId}; no proviene de Siigo`]
  );
  return { ...(await loadSupplier(conn)), id: created.insertId, duplicate: false };
}

async function loadOrder(conn, number) {
  const [rows] = await conn.execute(
    `SELECT oc.id, oc.numero, oc.tercero_id, oc.proveedor_nombre, oc.estado,
            d.id AS documento_id, d.sha256,
            p.siigo_code AS sku, p.modalidad_operativa,
            oci.cantidad_ordenada, oci.unidad
       FROM ordenes_compra_proveedor oc
       LEFT JOIN orden_compra_documentos d ON d.orden_compra_id = oc.id AND d.activo = 1
       LEFT JOIN orden_compra_proveedor_items oci ON oci.orden_compra_id = oc.id
       LEFT JOIN productos p ON p.id = oci.producto_id
      WHERE oc.numero = ? ORDER BY oci.id`,
    [number]
  );
  return rows;
}

async function createOutsourcingPurchaseOrder({ supplier, admin }) {
  if (!fs.existsSync(PDF_PATH)) throw new Error(`Falta el PDF ${PDF_PATH}`);
  const { createPurchaseOrderForUser } = require('../../api/v1/purchase-orders');
  const pdf = fs.readFileSync(PDF_PATH);
  return createPurchaseOrderForUser({
    user: { id: admin.id, rol: 'admin' },
    body: {
      numero: OUTSOURCING_ORDER_NUMBER,
      tercero_id: supplier.id,
      fecha_orden: '2026-09-02',
      archivo_nombre: path.basename(PDF_PATH),
      datos_origen: { demo: true, external_system: false, purpose: 'maquila_3q' },
      documento_pdf: {
        nombre: path.basename(PDF_PATH),
        mime_type: 'application/pdf',
        base64: pdf.toString('base64'),
      },
      items: [{
        sku: OUTSOURCING_SKU,
        cantidad: OUTSOURCING_QUANTITY,
        unidad: 'und',
        descripcion: 'PRODUCTO TERMINADO BOOSTER X 60',
      }],
    },
  });
}

async function availableBySku(conn) {
  const [rows] = await conn.execute(
    `SELECT p.siigo_code AS sku,
            COALESCE(SUM(CASE
              WHEN l.status = 'DISPONIBLE'
               AND (l.expiry_date IS NULL OR l.expiry_date >= CURDATE())
               AND u.activa = 1
              THEN s.cantidad - COALESCE(s.reservada, 0) ELSE 0 END), 0) AS disponible
       FROM productos p
       LEFT JOIN stock s ON s.producto_id = p.id
       LEFT JOIN lots l ON l.product_id = s.producto_id AND l.lpn = s.lote
       LEFT JOIN ubicaciones u ON u.id = s.ubicacion_id
      GROUP BY p.id, p.siigo_code`
  );
  return new Map(rows.map(row => [row.sku, Number(row.disponible)]));
}

async function pendingInputOrderBySku(conn) {
  const [rows] = await conn.execute(
    `SELECT p.siigo_code AS sku, SUM(oci.cantidad_ordenada) AS cantidad
       FROM ordenes_compra_proveedor oc
       JOIN orden_compra_proveedor_items oci ON oci.orden_compra_id = oc.id
       JOIN productos p ON p.id = oci.producto_id
      WHERE oc.numero = ? AND oc.estado IN ('CARGADA','RECIBIDA','RECIBIDA_PARCIAL')
      GROUP BY p.siigo_code`,
    [INPUT_ORDER_NUMBER]
  );
  return new Map(rows.map(row => [row.sku, Number(row.cantidad)]));
}

async function bomRequirements(conn, finalSku, quantity, stage) {
  const [rows] = await conn.execute(
    `SELECT pf.siigo_code AS producto_sku, pi.siigo_code AS insumo_sku,
            pi.nombre AS insumo, b.unidad,
            b.cantidad_por_unidad, b.cantidad_por_unidad * ? AS requerida
       FROM bom b
       JOIN productos pf ON pf.id = b.producto_final_id AND pf.activo = 1
       JOIN productos pi ON pi.id = b.insumo_id AND pi.activo = 1
      WHERE pf.siigo_code = ? AND b.etapa = ? ORDER BY b.id`,
    [quantity, finalSku, stage]
  );
  if (!rows.length) throw new Error(`No existe BOM ${stage} para ${finalSku}`);
  return rows.map(row => ({ ...row, requerida: Number(row.requerida) }));
}

function aggregateRequirements(groups) {
  const totals = new Map();
  for (const row of groups.flat()) {
    totals.set(row.insumo_sku, Number(((totals.get(row.insumo_sku) || 0) + row.requerida).toFixed(4)));
  }
  return totals;
}

async function inspectReadiness(conn) {
  const users = await loadUsers(conn);
  const inputOrder = await loadOrder(conn, INPUT_ORDER_NUMBER);
  const ioOrder = await loadOrder(conn, IO_ORDER_NUMBER);
  const outsourcingOrder = await loadOrder(conn, OUTSOURCING_ORDER_NUMBER);
  if (!inputOrder.length || !inputOrder[0].documento_id) throw new Error('La OC demo de insumos no esta lista con PDF');
  if (!['CARGADA', 'RECIBIDA', 'RECIBIDA_PARCIAL'].includes(inputOrder[0].estado)) {
    throw new Error(`La OC de insumos esta ${inputOrder[0].estado}; no se puede recibir en vivo`);
  }
  if (!ioOrder.length || !ioOrder[0].documento_id || ioOrder[0].estado !== 'CARGADA') {
    throw new Error('La OC demo IO no esta abierta con PDF');
  }
  if (outsourcingOrder.length) {
    if (outsourcingOrder.length !== 1
        || outsourcingOrder[0].sku !== OUTSOURCING_SKU
        || Number(outsourcingOrder[0].cantidad_ordenada) !== OUTSOURCING_QUANTITY
        || outsourcingOrder[0].modalidad_operativa !== 'PT'
        || !outsourcingOrder[0].documento_id
        || outsourcingOrder[0].estado !== 'CARGADA') {
      throw new Error('La OC demo 3Q existe, pero no coincide con el fixture esperado');
    }
  }
  const [existingOutsourcing] = await conn.execute(
    `SELECT om.id, om.codigo, om.estado
       FROM ordenes_maquila om
       JOIN ordenes_compra_proveedor oc ON oc.id = om.orden_compra_id
      WHERE oc.numero = ? AND om.estado <> 'CANCELADA'`,
    [OUTSOURCING_ORDER_NUMBER]
  );
  if (existingOutsourcing.length) {
    throw new Error(`La demo 3Q ya fue iniciada con ${existingOutsourcing[0].codigo}`);
  }

  const ownBom = await bomRequirements(conn, OWN_SKU, OWN_QUANTITY, 'PRODUCCION');
  const outsourcingBom = await bomRequirements(conn, OUTSOURCING_SKU, OUTSOURCING_QUANTITY, 'ENVIO');
  const requirements = aggregateRequirements([ownBom, outsourcingBom]);
  const available = await availableBySku(conn);
  const pending = await pendingInputOrderBySku(conn);
  const stockProjection = [...requirements.entries()].map(([sku, required]) => ({
    sku,
    required,
    available_now: Number(available.get(sku) || 0),
    expected_from_input_order: Number(pending.get(sku) || 0),
    projected_after_input_receipt: Number(((available.get(sku) || 0) + (pending.get(sku) || 0)).toFixed(4)),
  }));
  const insufficient = stockProjection.filter(row => row.projected_after_input_receipt + 0.0001 < row.required);
  if (insufficient.length) throw new Error(`Stock proyectado insuficiente: ${JSON.stringify(insufficient)}`);

  return {
    users,
    orders: {
      inputs: { id: inputOrder[0].id, number: INPUT_ORDER_NUMBER, state: inputOrder[0].estado },
      io: { id: ioOrder[0].id, number: IO_ORDER_NUMBER, state: ioOrder[0].estado },
      outsourcing: outsourcingOrder.length
        ? { id: outsourcingOrder[0].id, number: OUTSOURCING_ORDER_NUMBER, state: outsourcingOrder[0].estado }
        : null,
    },
    scenarios: {
      own_production: { sku: OWN_SKU, quantity: OWN_QUANTITY, bom: ownBom },
      in_and_out: { sku: ioOrder[0].sku, quantity: Number(ioOrder[0].cantidad_ordenada) },
      outsourcing_3q: { sku: OUTSOURCING_SKU, quantity: OUTSOURCING_QUANTITY, bom: outsourcingBom },
    },
    stock_projection: stockProjection,
  };
}

async function smokeOutsourcingReception(conn, readiness) {
  const { prepareOutsourcingReception } = require('../../api/_lib/outsourcing-workflow');
  const order = readiness.orders.outsourcing;
  if (!order) throw new Error('La OC demo 3Q debe existir antes del smoke');
  const [productRows] = await conn.execute(
    `SELECT id FROM productos WHERE siigo_code = ? AND modalidad_operativa = 'PT' AND activo = 1 LIMIT 1`,
    [OUTSOURCING_SKU]
  );
  if (!productRows.length) throw new Error('El producto PT de demo no esta disponible');
  const temporaryCode = `MQ-3Q-SMOKE-${Date.now()}`;
  await conn.beginTransaction();
  try {
    const [created] = await conn.execute(
      `INSERT INTO ordenes_maquila
         (codigo, orden_compra_id, tercero_id, proveedor_nombre, producto_id,
          cantidad_objetivo, cantidad_recibida, estado, notas, creado_por,
          enviado_por, enviado_en, creado_en, actualizado_en)
       SELECT ?, oc.id, oc.tercero_id, oc.proveedor_nombre, ?, ?, 0, 'EN_3Q',
              'Smoke transaccional con rollback', ?, ?, NOW(), NOW(), NOW()
         FROM ordenes_compra_proveedor oc WHERE oc.id = ?`,
      [temporaryCode, productRows[0].id, OUTSOURCING_QUANTITY,
       readiness.users.admin.id, readiness.users.admin.id, order.id]
    );
    if (created.affectedRows !== 1) throw new Error('No fue posible crear la orden temporal del smoke');
    const prepared = await prepareOutsourcingReception(conn, {
      orderId: created.insertId,
      quantity: 3,
      userId: readiness.users.rotating.id,
    });
    const replay = await prepareOutsourcingReception(conn, {
      orderId: created.insertId,
      quantity: 3,
      userId: readiness.users.rotating.id,
    });
    if (prepared.duplicate || !replay.duplicate || prepared.id !== replay.id) {
      throw new Error('La preparacion 3Q no fue idempotente');
    }
    if (Number(prepared.cantidad_entrega) !== 3
        || Number(prepared.items?.[0]?.cantidad_pendiente) !== 3
        || Number(prepared.orden_maquila_id) !== Number(created.insertId)) {
      throw new Error('La recepcion 3Q preparada no conserva orden y cantidad de entrega');
    }
    const [stored] = await conn.execute(
      `SELECT r.siigo_purchase_id, r.orden_compra_id, r.estado, ri.cantidad_esp
         FROM recepciones r JOIN recepcion_items ri ON ri.recepcion_id = r.id
        WHERE r.id = ?`,
      [prepared.id]
    );
    if (stored.length !== 1 || stored[0].siigo_purchase_id != null
        || Number(stored[0].orden_compra_id) !== Number(order.id)
        || stored[0].estado !== 'borrador'
        || Number(stored[0].cantidad_esp) !== 3) {
      throw new Error('El borrador 3Q no quedo aislado de Siigo o contiene datos inesperados');
    }
    await conn.rollback();
    return {
      ok: true,
      transaction: 'rolled_back',
      prepared_number: prepared.numero,
      delivery_quantity: prepared.cantidad_entrega,
      replay_detected: replay.duplicate,
      siigo_dependency: false,
    };
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes(APPLY_FLAG);
  if (apply && !process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para aplicar usa ${APPLY_FLAG} ${CONFIRM_FLAG}`);
  }
  const conn = await mysql.createConnection(connectionConfig());
  try {
    const users = await loadUsers(conn);
    let supplier = await loadSupplier(conn);
    const existingOrder = await loadOrder(conn, OUTSOURCING_ORDER_NUMBER);
    if (!apply) {
      const readiness = existingOrder.length ? await inspectReadiness(conn) : null;
      const smoke = readiness && process.argv.includes('--smoke-reception')
        ? await smokeOutsourcingReception(conn, readiness)
        : null;
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        changes: {
          create_demo_supplier: !supplier,
          create_demo_outsourcing_purchase_order: !existingOrder.length,
        },
        current_rotating_role: users.rotating.rol,
        readiness,
        smoke,
      }, null, 2));
      return;
    }
    if (!supplier) {
      await conn.beginTransaction();
      try {
        supplier = await ensureSupplier(conn, users.admin.id);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
    }
    if (!existingOrder.length) await createOutsourcingPurchaseOrder({ supplier, admin: users.admin });
    const readiness = await inspectReadiness(conn);
    const smoke = process.argv.includes('--smoke-reception')
      ? await smokeOutsourcingReception(conn, readiness)
      : null;
    console.log(JSON.stringify({ ok: true, mode: 'applied', supplier, readiness, smoke }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
