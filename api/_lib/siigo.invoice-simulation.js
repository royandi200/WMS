// Simulación de importación de facturas de SIIGO, SOLO LECTURA.
//
// Revisa facturas reales con las mismas reglas que siigo.invoice-import.js
// (cliente, productos, bodega, stock trazable, anulada, ya importada) y dice,
// factura por factura, qué pasaría al importarla. No escribe en la base ni en
// SIIGO y no envía notificaciones: no llama a importInvoice.
const { query } = require('./db');
const { siigoGet } = require('./siigo.service');

const PAGE_SIZE = 50;
const MAX_PAGES = 5;

const ISSUE_TEXT = {
  ANULADA: 'Anulada en SIIGO: no genera despacho',
  YA_IMPORTADA: 'Ya existe un despacho para esta factura',
  ANTES_DEL_INICIO: 'Fecha anterior al inicio de operación: se ignora',
  SIN_ITEMS: 'La factura no tiene productos',
  CLIENTE_NO_SINCRONIZADO: 'El cliente no está en el WMS: el despacho quedaría como borrador PENDIENTE_DATOS_CLIENTE',
  PRODUCTO_NO_SINCRONIZADO: 'Producto que no existe en el WMS: la factura iría a Novedades SIIGO',
  SIN_INVENTARIO_NUNCA: 'Producto que nunca ha tenido lotes en el WMS (probable servicio, envío o combo): quedaría PENDIENTE_STOCK',
  BODEGA_NO_HABILITADA: 'Bodega de SIIGO distinta a las habilitadas: la factura iría a Novedades SIIGO',
  BODEGAS_MULTIPLES: 'Usa varias bodegas de SIIGO: la factura iría a Novedades SIIGO',
  SIN_STOCK: 'Stock trazable insuficiente: quedaría PENDIENTE_STOCK',
};

function acceptedWarehouses() {
  return String(process.env.SIIGO_WAREHOUSE_IDS || '1,32')
    .split(',').map(value => Number(value.trim())).filter(Number.isFinite);
}

async function fetchInvoices({ dateStart, dateEnd }) {
  const invoices = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await siigoGet('/v1/invoices', {
      params: { date_start: dateStart, date_end: dateEnd, page, page_size: PAGE_SIZE },
      entidad: 'factura_simulada',
      logResponse: false,
    });
    const results = response?.results ?? (Array.isArray(response) ? response : []);
    for (const summary of results) {
      const date = String(summary?.date || '').slice(0, 10);
      if (date && (date < dateStart || date > dateEnd)) continue;
      invoices.push(summary?.items?.length && summary?.customer
        ? summary
        : await siigoGet(`/v1/invoices/${encodeURIComponent(summary.id)}`, {
          entidad: 'factura_simulada', logResponse: false,
        }));
    }
    const totalPages = Number(response?.pagination?.total_pages || 0);
    if (results.length < PAGE_SIZE || (totalPages && page >= totalPages)) {
      return { invoices, truncated: false };
    }
  }
  return { invoices, truncated: true };
}

async function loadContext(invoices) {
  const codes = [...new Set(invoices.flatMap(invoice => (invoice.items || [])
    .map(item => String(item.code || '').trim()).filter(Boolean)))];
  const products = new Map();
  if (codes.length) {
    const rows = await query(
      `SELECT id, siigo_code, nombre, tipo_producto
         FROM productos WHERE siigo_code IN (${codes.map(() => '?').join(',')})`,
      codes
    );
    for (const row of rows) products.set(String(row.siigo_code), row);
  }
  const stock = new Map();
  const everStocked = new Set();
  const productIds = [...products.values()].map(row => row.id);
  if (productIds.length) {
    const lotRows = await query(
      `SELECT DISTINCT product_id FROM lots WHERE product_id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    );
    for (const row of lotRows) everStocked.add(Number(row.product_id));
    // Misma condición de stock trazable que allocateProduct en la importación.
    const rows = await query(
      `SELECT s.producto_id, SUM(s.cantidad - COALESCE(s.reservada, 0)) AS disponible
         FROM stock s
         LEFT JOIN lots l ON BINARY l.lpn = BINARY s.lote
         JOIN ubicaciones u ON u.id = s.ubicacion_id AND u.bodega_id = s.bodega_id AND u.activa = 1
        WHERE s.producto_id IN (${productIds.map(() => '?').join(',')})
          AND s.lote IS NOT NULL
          AND (s.cantidad - COALESCE(s.reservada, 0)) > 0
          AND COALESCE(l.status, 'DISPONIBLE') = 'DISPONIBLE'
          AND (COALESCE(l.expiry_date, s.fecha_venc) IS NULL OR COALESCE(l.expiry_date, s.fecha_venc) >= CURDATE())
        GROUP BY s.producto_id`,
      productIds
    );
    for (const row of rows) stock.set(Number(row.producto_id), Number(row.disponible || 0));
  }
  const ids = invoices.map(invoice => String(invoice.id || '')).filter(Boolean);
  const imported = new Map();
  if (ids.length) {
    const rows = await query(
      `SELECT siigo_invoice_id, numero, estado FROM despachos
        WHERE siigo_invoice_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    for (const row of rows) imported.set(String(row.siigo_invoice_id), row);
  }
  const mappedWarehouses = (await query(
    `SELECT siigo_id FROM bodegas WHERE activa = 1 AND siigo_id IS NOT NULL`
  )).map(row => Number(row.siigo_id));
  return { products, stock, everStocked, imported, mappedWarehouses };
}

async function customerExists(customer) {
  const siigoId = String(customer?.id || '').trim();
  const identification = String(customer?.identification || '').trim();
  if (!siigoId && !identification) return false;
  const rows = await query(
    `SELECT id FROM terceros WHERE siigo_id = ? OR identification = ? LIMIT 1`,
    [siigoId, identification]
  );
  return rows.length > 0;
}

async function simulateInvoices({ dateStart, dateEnd, importStart }) {
  const { invoices, truncated } = await fetchInvoices({ dateStart, dateEnd });
  const context = await loadContext(invoices);
  const accepted = new Set([...acceptedWarehouses(), ...context.mappedWarehouses]);
  // El stock se va consumiendo en orden de factura, como ocurriría al importar.
  const remainingStock = new Map(context.stock);
  const results = [];

  for (const invoice of invoices.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))) {
    const issues = [];
    const lines = [];
    const add = (code, extra) => { if (!issues.some(issue => issue.code === code)) issues.push({ code, text: ISSUE_TEXT[code], ...extra }); };
    const date = String(invoice.date || '').slice(0, 10);
    const existing = context.imported.get(String(invoice.id));

    if (invoice.annulled === true) add('ANULADA');
    if (existing) add('YA_IMPORTADA', { detalle: `${existing.numero} (${existing.estado})` });
    if (importStart && date && date < importStart) add('ANTES_DEL_INICIO');
    if (!(invoice.items || []).length) add('SIN_ITEMS');
    if (!await customerExists(invoice.customer)) {
      add('CLIENTE_NO_SINCRONIZADO', { detalle: String(invoice.customer?.identification || invoice.customer?.id || '') });
    }

    const warehouses = new Set();
    const missing = [];
    const services = [];
    const shortages = [];
    for (const item of invoice.items || []) {
      const code = String(item.code || '').trim();
      const quantity = Number(item.quantity || 0);
      const warehouse = Number(item.warehouse?.id ?? item.warehouse ?? 0) || null;
      const product = context.products.get(code);
      lines.push({ code, descripcion: item.description || product?.nombre || '', cantidad: quantity, bodega: warehouse });
      if (warehouse) warehouses.add(warehouse);
      if (warehouse && !accepted.has(warehouse)) add('BODEGA_NO_HABILITADA', { detalle: `bodega ${warehouse}` });
      if (!product) { missing.push(code); continue; }
      if (!context.everStocked.has(Number(product.id))) { services.push(code); continue; }
      const available = remainingStock.get(Number(product.id)) || 0;
      if (available < quantity) shortages.push(`${code}: pide ${quantity}, hay ${available}`);
      remainingStock.set(Number(product.id), Math.max(0, available - quantity));
    }
    if (warehouses.size > 1) add('BODEGAS_MULTIPLES');
    if (missing.length) add('PRODUCTO_NO_SINCRONIZADO', { detalle: missing.join(', ') });
    if (services.length) add('SIN_INVENTARIO_NUNCA', { detalle: services.join(', ') });
    if (shortages.length) add('SIN_STOCK', { detalle: shortages.join(' · ') });

    const blocking = issues.filter(issue => !['YA_IMPORTADA', 'ANULADA', 'ANTES_DEL_INICIO'].includes(issue.code));
    results.push({
      siigo_invoice_id: invoice.id,
      factura: invoice.name,
      fecha: date || null,
      cliente: String(invoice.customer?.identification || ''),
      lineas: lines,
      veredicto: issues.some(issue => issue.code === 'ANULADA') ? 'IGNORADA'
        : existing ? 'YA_IMPORTADA'
          : issues.some(issue => issue.code === 'ANTES_DEL_INICIO') ? 'IGNORADA'
            : blocking.length ? 'CON_PROBLEMAS' : 'PASARIA',
      problemas: issues,
    });
  }

  const count = (verdict) => results.filter(result => result.veredicto === verdict).length;
  const byIssue = {};
  for (const result of results) for (const issue of result.problemas) byIssue[issue.code] = (byIssue[issue.code] || 0) + 1;
  return {
    rango: { desde: dateStart, hasta: dateEnd },
    truncado: truncated,
    total: results.length,
    pasarian: count('PASARIA'),
    con_problemas: count('CON_PROBLEMAS'),
    ya_importadas: count('YA_IMPORTADA'),
    ignoradas: count('IGNORADA'),
    por_problema: byIssue,
    facturas: results,
  };
}

module.exports = { ISSUE_TEXT, simulateInvoices };
