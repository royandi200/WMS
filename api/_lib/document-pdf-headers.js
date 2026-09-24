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

module.exports = { recoverWarehousePdfHeaders };
