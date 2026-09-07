const { detectDocumentTypeMarkers, normalizeMarkerText } = require('./document-type-markers');

const FIELDS = {
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

// Exact labels only, before the item table. Never infer identity, lots or quantities.
function recoverWarehousePdfHeaders(body, text) {
  const source = body?.params && typeof body.params === 'object' ? body.params : body;
  const markers = detectDocumentTypeMarkers(text);
  if (source?.tipo_documento !== 'SALIDA_BODEGA_3Q' || !markers.outsourcingExit || markers.purchaseOrder) return body;
  const lines = String(text || '').split(/\r?\n/);
  const candidates = new Map();
  function add(label, raw) {
    const field = FIELDS[normalizeMarkerText(label)];
    const value = String(raw || '').trim();
    if (!field || !value || value.length > 255 || FIELDS[normalizeMarkerText(value)]) return;
    let parsed = value;
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
    if (cells.length && cells.every(cell => FIELDS[normalizeMarkerText(cell)])) {
      const values = (lines[i + 1] || '').split('\t');
      if (values.length === cells.length && values.every(value => !FIELDS[normalizeMarkerText(value)])) {
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
  const warnings = [];
  for (const [field, values] of candidates) {
    if (values.size !== 1) {
      warnings.push(`El PDF contiene valores contradictorios para ${field}; revisa el original`);
      continue;
    }
    const [value] = values;
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

module.exports = { recoverWarehousePdfHeaders };
