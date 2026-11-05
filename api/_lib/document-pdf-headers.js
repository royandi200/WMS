const { detectDocumentTypeMarkers, normalizeMarkerText } = require('./document-type-markers');

const OUTSOURCING_EXIT_FIELDS = {
  'NUMERO DE SALIDA': 'referencia_documento',
  FECHA: 'fecha_documento',
  DESTINATARIO: 'nombre_cliente',
  DIRECCION: 'direccion',
  'CIUDAD Y DEPARTAMENTO': 'ciudad_departamento',
  'CIUDAD DEPARTAMENTO': 'ciudad_departamento',
  ENTREGA: 'entrega',
  RECIBE: 'recibe',
  TELEFONO: 'telefono',
  'NIT DESTINATARIO': 'nit',
  'BULTOS DECLARADOS': 'total_bultos',
  'TOTAL BULTOS': 'total_bultos',
};

const PURCHASE_ORDER_FIELDS = {
  'NUMERO DE OC': 'referencia_documento',
  'FECHA DE ORDEN': 'fecha_documento',
  FECHA: 'fecha_documento',
  PROVEEDOR: 'proveedor_nombre',
  'NIT PROVEEDOR': 'proveedor_nit',
  MONEDA: 'moneda',
};

const CUSTOMER_PURCHASE_ORDER_FIELDS = {
  'REFERENCIA DE LA OC': 'referencia_documento',
  'NUMERO DE OC': 'referencia_documento',
  'NUMERO DE PEDIDO': 'referencia_documento',
  FECHA: 'fecha_documento',
  'FECHA DE ORDEN': 'fecha_documento',
  'CLIENTE FINAL': 'nombre_cliente',
  CLIENTE: 'nombre_cliente',
  DESTINO: 'destino',
};

const IDENTITY_FIELDS = new Set([
  'referencia_documento',
  'fecha_documento',
  'proveedor_nombre',
  'proveedor_nit',
  'moneda',
  'nombre_cliente',
]);

function documentHeaderProfile(markers, source) {
  if (Object.values(markers).filter(Boolean).length !== 1) return null;
  if (markers.customerPurchaseOrder) {
    return { type: 'ORDEN_COMPRA_CLIENTE', fields: CUSTOMER_PURCHASE_ORDER_FIELDS };
  }
  if (markers.purchaseOrder && (!source?.tipo_documento || source.tipo_documento === 'ORDEN_COMPRA')) {
    return { type: 'ORDEN_COMPRA', fields: PURCHASE_ORDER_FIELDS };
  }
  if (markers.outsourcingExit && (!source?.tipo_documento || source.tipo_documento === 'SALIDA_BODEGA_3Q')) {
    return { type: 'SALIDA_BODEGA_3Q', fields: OUTSOURCING_EXIT_FIELDS };
  }
  return null;
}

// Exact labels only, before the item table. Recover missing identity fields but
// never infer lots or quantities and never overwrite identity supplied upstream.
function recoverWarehousePdfHeaders(body, text) {
  const source = body?.params && typeof body.params === 'object' ? body.params : body;
  const markers = detectDocumentTypeMarkers(text);
  const profile = documentHeaderProfile(markers, source);
  if (!profile) return body;
  const fields = profile.fields;
  const lines = String(text || '').split(/\r?\n/);
  const candidates = new Map();
  function add(label, raw) {
    const field = fields[normalizeMarkerText(label)];
    const value = String(raw || '').trim();
    if (!field || !value || value.length > 255 || fields[normalizeMarkerText(value)]) return;
    let parsed = value;
    if (field === 'fecha_documento' && profile.type === 'ORDEN_COMPRA_CLIENTE') {
      parsed = parseCustomerOrderDate(value);
      if (!parsed) return;
    }
    if (field === 'total_bultos') {
      const match = value.match(/^(\d+)(?:\s+(?:paquetes?|bultos?|cajas?))?$/iu);
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) return;
      parsed = Number(match[1]);
    }
    if (!candidates.has(field)) candidates.set(field, new Set());
    candidates.get(field).add(parsed);
  }
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('\t').map(cell => cell.trim());
    if (cells.some(cell => /^(SKU|CODIGO DE BARRAS|CODIGO)$/u.test(normalizeMarkerText(cell)))) break;
    // PDF.js preserves cell columns as tabs. Accept label rows only when every
    // cell is a known header; partial column matches could shift a value.
    if (cells.length && cells.every(cell => fields[normalizeMarkerText(cell)])) {
      const values = (lines[i + 1] || '').split('\t');
      if (values.length === cells.length && values.every(value => !fields[normalizeMarkerText(value)])) {
        cells.forEach((label, index) => add(label, values[index]));
        i++;
      }
    } else {
      for (const cell of cells) {
        const match = cell.match(/^([^:]+):\s*(.+)$/u);
        if (match) add(match[1], match[2]);
      }
    }
  }
  const recovered = {};
  if (source?.tipo_documento !== profile.type) recovered.tipo_documento = profile.type;
  const warnings = [];
  for (const [field, values] of candidates) {
    if (values.size !== 1) {
      warnings.push(`El PDF contiene valores contradictorios para ${field}; revisa el original`);
      continue;
    }
    const [value] = values;
    if (profile.type !== 'ORDEN_COMPRA_CLIENTE'
      && IDENTITY_FIELDS.has(field) && source[field] != null && String(source[field]).trim()) continue;
    recovered[field] = value;
    if (source[field] != null && String(source[field]).trim() !== String(value)) {
      warnings.push(`Se recupero ${field} del PDF original; difiere de la extraccion de IA`);
    }
  }
  if (!Object.keys(recovered).length && !warnings.length) return body;
  const result = { ...source, ...recovered };
  if (warnings.length) result.advertencias = [...(Array.isArray(source.advertencias) ? source.advertencias : []), ...warnings];
  return body.params ? { ...body, params: result } : result;
}

function parseCustomerOrderDate(value) {
  const iso = String(value).match(/^\d{4}-\d{2}-\d{2}$/u);
  if (iso) return iso[0];
  const match = String(value).toLowerCase().match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})$/u);
  if (!match) return null;
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const month = months.indexOf(match[2]);
  if (month < 0) return null;
  const candidate = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const date = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate ? null : candidate;
}

// SIIGO prints its purchase orders as "No. OC-1-354", "Fecha<TAB>2026-10-16" and two
// "Nit" lines (buyer and supplier) whose columns interleave. Fill only missing fields.
const OWN_TAX_ID = String(process.env.COMPANY_NIT || '901189721').replace(/\D/g, '').slice(0, 9);

function recoverSiigoPurchaseOrderHeaders(body, text) {
  const raw = String(text || '');
  if (!/^Orden de compra$/imu.test(raw) || !/^No\.\s*\S+\s*$/mu.test(raw)) return body;
  const source = body?.params && typeof body.params === 'object' ? body.params : body;
  const found = {};
  const reference = raw.match(/^No\.\s*(\S+)\s*$/mu);
  if (reference) found.referencia_documento = reference[1];
  const date = raw.match(/^Fecha\s+(\d{4}-\d{2}-\d{2})\s*$/mu);
  if (date) found.fecha_documento = date[1];
  const taxIds = [...raw.matchAll(/Nit\s+([\d.]{6,}-?\d?)/gu)].map((m) => m[1])
    .filter((value) => value.replace(/\D/g, '').slice(0, 9) !== OWN_TAX_ID);
  if (new Set(taxIds).size === 1) found.proveedor_nit = taxIds[0];
  const recovered = {};
  for (const [field, value] of Object.entries(found)) {
    if (!String(source?.[field] ?? '').trim()) recovered[field] = value;
  }
  if (!source?.tipo_documento) recovered.tipo_documento = 'ORDEN_COMPRA';
  if (!Object.keys(recovered).length) return body;
  const result = { ...source, ...recovered };
  return body?.params ? { ...body, params: result } : result;
}

module.exports = { recoverWarehousePdfHeaders, recoverSiigoPurchaseOrderHeaders };

// Deterministic fallback for SIIGO OC item tables (used when the AI reader is
// unavailable). Rows start with "description<TAB>quantity"; continuation lines
// carry the rest of the description. The SKU is matched by shared name words.
const STOP_WORDS = new Set(['DE', 'Y', 'LA', 'EL', 'CON', 'X', 'POR', 'PARA']);

function nameWords(value) {
  return new Set(normalizeMarkerText(value).split(/[^A-Z0-9]+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 3 ? word.replace(/S$/u, '') : word)));
}

function siigoPurchaseOrderItems(text, products = []) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((line) => /^Unitario\t/u.test(line) || /^[ÍI]tem\tDescripci/u.test(line));
  const end = lines.findIndex((line, index) => index > start && /^Total Bruto/u.test(line));
  if (start < 0 || end < 0) return [];
  const isNumber = (cell) => /^-?[\d.,]+\s*%?$/u.test(cell.trim());
  const rows = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^(Unitario|[ÍI]tem)\t/u.test(line)) continue;
    const cells = line.split('\t').map((cell) => cell.trim()).filter(Boolean);
    if (!cells.length || cells.every(isNumber)) continue;
    const textCells = cells.filter((cell) => !isNumber(cell));
    const quantityCell = cells.find((cell, index) => index > 0 && isNumber(cell) && !cell.includes('%'));
    if (quantityCell && !isNumber(cells[0])) {
      const quantity = Number(quantityCell.replace(/,/gu, ''));
      if (Number.isFinite(quantity) && quantity > 0) rows.push({ descripcion: textCells.join(' '), cantidad: quantity });
    } else if (rows.length) {
      rows[rows.length - 1].descripcion = `${rows[rows.length - 1].descripcion} ${textCells.join(' ')}`.trim();
    }
  }
  return rows.map((row) => {
    const wanted = nameWords(row.descripcion);
    const scored = products.map((product) => {
      const words = nameWords(product.nombre);
      return { sku: String(product.siigo_code), score: [...wanted].filter((word) => words.has(word)).length };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    if (!scored.length) return { ...row };
    const close = scored.filter((entry) => entry.score >= scored[0].score - 0).slice(1, 4).map((entry) => entry.sku);
    return { ...row, sku: scored[0].sku, alternativas: close };
  });
}

module.exports.siigoPurchaseOrderItems = siigoPurchaseOrderItems;
