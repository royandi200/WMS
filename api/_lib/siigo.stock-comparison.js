// Comparacion de saldos WMS vs SIIGO (solo lectura en SIIGO).
//
// SIIGO descuenta al facturar; el WMS descuenta al despachar. Por eso lo
// facturado que aun no sale de bodega explica parte de la diferencia:
//   diferencia_sin_explicar = saldo_wms - saldo_siigo - facturado_pendiente
const { query } = require('./db');
const { siigoGet } = require('./siigo.service');

const PAGE_SIZE = 100;

let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await query(
    `CREATE TABLE IF NOT EXISTS siigo_stock_comparaciones (
       id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       origen VARCHAR(20) NOT NULL,
       usuario_id INT UNSIGNED NULL,
       resumen TEXT NOT NULL,
       filas MEDIUMTEXT NOT NULL
     )`
  );
  tableReady = true;
}

async function siigoStockByCode() {
  const byCode = new Map();
  for (let page = 1; page <= 50; page++) {
    const resp = await siigoGet('/v1/products', { params: { page, page_size: PAGE_SIZE }, entidad: 'stock-comparacion' });
    const results = resp?.results ?? (Array.isArray(resp) ? resp : []);
    for (const p of results) {
      byCode.set(String(p.code).trim().toUpperCase(), {
        nombre: p.name,
        control_stock: p.stock_control === true,
        cantidad: Number(p.available_quantity) || 0,
        bodegas: (p.warehouses || []).map((w) => ({ nombre: String(w.name || '').trim(), cantidad: Number(w.quantity) || 0 })),
      });
    }
    const total = resp?.pagination?.total_results ?? 0;
    if (!results.length || byCode.size >= total) break;
  }
  return byCode;
}

async function wmsRows() {
  return query(
    `SELECT p.id, p.siigo_code, p.nombre,
            COALESCE((SELECT SUM(s.cantidad) FROM stock s WHERE s.producto_id = p.id), 0) AS saldo_wms,
            COALESCE((SELECT SUM(GREATEST(dd.cantidad_facturada - dd.cantidad_despachada, 0))
                        FROM despacho_demanda_items dd JOIN despachos d ON d.id = dd.despacho_id
                       WHERE dd.producto_id = p.id AND d.estado NOT IN ('despachado', 'anulado')), 0) AS facturado_pendiente
       FROM productos p
      WHERE p.activo = 1 AND p.siigo_code IS NOT NULL AND p.siigo_code <> ''`
  );
}

function compareStock(wms, siigo) {
  const rows = wms.map((p) => {
    const code = String(p.siigo_code).trim().toUpperCase();
    const s = siigo.get(code);
    const saldoWms = Number(p.saldo_wms) || 0;
    const pendiente = Number(p.facturado_pendiente) || 0;
    if (!s) {
      return { sku: p.siigo_code, nombre: p.nombre, saldo_wms: saldoWms, saldo_siigo: null, facturado_pendiente: pendiente,
        diferencia: null, bodegas_siigo: [], estado: 'NO_EN_SIIGO', nota: 'El producto no existe en SIIGO con ese codigo.' };
    }
    const diferencia = Math.round((saldoWms - s.cantidad - pendiente) * 1000) / 1000;
    const negativas = s.bodegas.filter((b) => b.cantidad < 0);
    const notas = [];
    if (negativas.length) notas.push(`SIIGO tiene saldo negativo en: ${negativas.map((b) => `${b.nombre} (${b.cantidad})`).join(', ')}.`);
    if (pendiente) notas.push(`${pendiente} facturado en SIIGO pendiente de despacho.`);
    if (!s.control_stock) notas.push('En SIIGO no controla inventario.');
    let estado = 'OK';
    if (diferencia !== 0) estado = 'DIFERENCIA';
    else if (negativas.length) estado = 'REVISAR';
    return { sku: p.siigo_code, nombre: p.nombre, saldo_wms: saldoWms, saldo_siigo: s.cantidad, facturado_pendiente: pendiente,
      diferencia, bodegas_siigo: s.bodegas, estado, nota: notas.join(' ') };
  });
  const order = { DIFERENCIA: 0, REVISAR: 1, NO_EN_SIIGO: 2, OK: 3 };
  rows.sort((a, b) => order[a.estado] - order[b.estado] || Math.abs(b.diferencia || 0) - Math.abs(a.diferencia || 0));
  const count = (estado) => rows.filter((r) => r.estado === estado).length;
  return {
    resumen: { productos: rows.length, ok: count('OK'), con_diferencia: count('DIFERENCIA'), revisar: count('REVISAR'), no_en_siigo: count('NO_EN_SIIGO') },
    filas: rows,
  };
}

async function runStockComparison({ origen, usuarioId = null }) {
  await ensureTable();
  const [siigo, wms] = await Promise.all([siigoStockByCode(), wmsRows()]);
  const result = compareStock(wms, siigo);
  const saved = await query(
    'INSERT INTO siigo_stock_comparaciones (origen, usuario_id, resumen, filas) VALUES (?, ?, ?, ?)',
    [origen, usuarioId, JSON.stringify(result.resumen), JSON.stringify(result.filas)]
  );
  return { id: saved.insertId, creado_en: new Date().toISOString(), origen, ...result };
}

async function latestStockComparison() {
  await ensureTable();
  const rows = await query('SELECT id, creado_en, origen, resumen, filas FROM siigo_stock_comparaciones ORDER BY id DESC LIMIT 1');
  if (!rows.length) return null;
  const r = rows[0];
  return { id: r.id, creado_en: r.creado_en, origen: r.origen, resumen: JSON.parse(r.resumen), filas: JSON.parse(r.filas) };
}

module.exports = { compareStock, runStockComparison, latestStockComparison };
