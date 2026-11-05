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

// Deterministic reader for SIIGO OC item tables (no AI). PDF.js returns the
// table cells in reading order: index, description (1+ cells), quantity,
// unit price, discount, tax %, withholding %, total. A SKU is proposed only when
// the product type matches (FUNDA, ETIQUETA, TAPA...) and the match is clear.
const STOP_WORDS = new Set(['DE', 'Y', 'LA', 'EL', 'CON', 'X', 'POR', 'PARA', 'UND', 'UNIDADES', 'SEGUN', 'A', 'UNA']);
const TYPE_WORDS = new Set(['GOMA', 'FUNDA', 'ETIQUETA', 'TAPA', 'CAJA', 'TARRO', 'LINER', 'FRASCO', 'BOLSA', 'PRODUCTO']);

function nameWords(value) {
  const text = normalizeMarkerText(value)
    .replace(/\bLB\b/gu, 'LINEA BLANCA')
    .replace(/\bMATERIA PRIMA\b/gu, 'GOMAS')
    .replace(/\bX\s*(\d+)/gu, 'X$1');
  return text.split(/[^A-Z0-9]+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 3 && !/\d/u.test(word) ? word.replace(/S$/u, '') : word));
}

function matchCatalog(description, products) {
  // SIIGO prints the product's own name on the OC: an exact name wins outright.
  const exactKey = nameWords(description).join(' ');
  const exact = products.filter((product) => nameWords(product.nombre).join(' ') === exactKey);
  if (exact.length === 1) return { sku: String(exact[0].siigo_code), alternativas: [] };
  const wanted = nameWords(description);
  const wantedType = wanted.find((word) => TYPE_WORDS.has(word)) || null;
  const scored = products.map((product) => {
    const words = nameWords(product.nombre);
    const type = words.find((word) => TYPE_WORDS.has(word)) || null;
    if (wantedType && type !== wantedType) return null;
    const shared = wanted.filter((word) => !TYPE_WORDS.has(word) && words.includes(word));
    return shared.length ? { sku: String(product.siigo_code), score: shared.length, extra: words.length - shared.length } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.extra - b.extra);
  if (!scored.length) return {};
  // A product whose name contains every descriptive word of the row beats partial matches.
  const descriptive = wanted.filter((word) => !TYPE_WORDS.has(word)).length;
  const complete = scored.filter((entry) => entry.score === descriptive);
  if (descriptive >= 2 && complete.length === 1) {
    return { sku: complete[0].sku, alternativas: scored.filter((e) => e !== complete[0]).slice(0, 2).map((e) => e.sku) };
  }
  const top = scored.filter((entry) => entry.score === scored[0].score);
  // Without a type word, demand two shared words; never pick among 3+ equals.
  if ((!wantedType && scored[0].score < 2) || top.length > 2) return { candidatos: top.slice(0, 4).map((e) => e.sku) };
  return { sku: top[0].sku, alternativas: scored.slice(1, 3).map((entry) => entry.sku) };
}

function siigoPurchaseOrderItems(tokens = [], products = []) {
  const cells = tokens.map((token) => String(typeof token === 'object' && token ? token.text : token).trim()).filter(Boolean);
  const start = cells.findIndex((cell) => cell === 'Vr. Total');
  if (start < 0) return [];
  const isNumber = (cell) => /^-?\d[\d.,]*$/u.test(cell);
  const rows = [];
  let i = start + 1;
  while (i < cells.length && /^\d{1,3}$/u.test(cells[i])) {
    const description = [];
    i += 1;
    while (i < cells.length && !isNumber(cells[i])) description.push(cells[i++]);
    const quantity = Number(String(cells[i] || '').replace(/,/gu, ''));
    if (!description.length || !Number.isFinite(quantity) || quantity <= 0) break;
    rows.push({ descripcion: description.join(' '), cantidad: quantity });
    i += 1;
    while (i < cells.length && !/^\d{1,3}$/u.test(cells[i]) && (isNumber(cells[i]) || /%$/u.test(cells[i]))) i += 1;
  }
  return rows.map((row) => ({ ...row, ...matchCatalog(row.descripcion, products) }));
}

module.exports.siigoPurchaseOrderItems = siigoPurchaseOrderItems;
