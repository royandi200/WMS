const test = require('node:test');
const assert = require('node:assert/strict');

const {
  lotStatusForReturn,
  normalizeReturnInput,
  normalizeReturnStatus,
  parseCustomerReturnReferences,
  assertReturnDispositionEnabled,
} = require('../api/_lib/returns-workflow');

test('normalizes a traceable quarantined customer return', () => {
  assert.deepEqual(normalizeReturnInput({
    id_factura: 'FV-1-10000004804',
    referencia_devolucion: 'RMA-QA-001',
    id_item: 'WMSQA260721P01',
    lote_origen: 'WMSQA260721LOT01',
    cantidad: 1,
    estado: 'cuarentena',
  }), {
    dispatchReference: 'FV-1-10000004804',
    externalReference: 'RMA-QA-001',
    sku: 'WMSQA260721P01',
    sourceLot: 'WMSQA260721LOT01',
    customer: '',
    destinationLocation: '',
    notes: '',
    confirmNew: false,
    quantity: 1,
    status: 'CUARENTENA',
  });
});

test('requires source traceability and a destination for recoverable returns', () => {
  assert.throws(
    () => normalizeReturnInput({ id_item: 'SKU', cantidad: 1, estado: 'CUARENTENA' }),
    /Factura o despacho origen/
  );
  assert.throws(
    () => normalizeReturnInput({
      id_factura: 'FV-1', referencia_devolucion: 'RMA-1', id_item: 'SKU',
      lote_origen: 'LOT-1', cantidad: 1, estado: 'RECUPERABLE',
    }),
    /Ubicacion destino/
  );
});

test('maps return disposition to a supported physical lot status', () => {
  assert.equal(normalizeReturnStatus('destruccion'), 'DESTRUCCION');
  assert.equal(lotStatusForReturn('RECUPERABLE'), 'DISPONIBLE');
  assert.equal(lotStatusForReturn('CUARENTENA'), 'CUARENTENA');
  assert.equal(lotStatusForReturn('DESTRUCCION'), 'PENDIENTE_DISPOSICION');
});

test('final return disposal stays disabled unless explicitly enabled', () => {
  assert.throws(
    () => assertReturnDispositionEnabled('DESTRUCCION', { allowReturnDisposal: false }),
    /disposicion final de devoluciones esta deshabilitada/u
  );
  assert.doesNotThrow(
    () => assertReturnDispositionEnabled('DESTRUCCION', { allowReturnDisposal: true })
  );
  assert.doesNotThrow(
    () => assertReturnDispositionEnabled('CUARENTENA', { allowReturnDisposal: false })
  );
});

test('recovers trace references from the immutable user message', () => {
  assert.deepEqual(
    parseCustomerReturnReferences(
      'registra devolucion del lote WMSQA260721LOT01 para la factura FV-1-10000004804 referencia E2E-RET-001'
    ),
    {
      id_factura: 'FV-1-10000004804',
      lote_origen: 'WMSQA260721LOT01',
      referencia_devolucion: 'E2E-RET-001',
    }
  );
});

test('dashboard and BuilderBot use the shared return workflow', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dashboard = fs.readFileSync(path.join(__dirname, '../api/v1/returns.js'), 'utf8');
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(dashboard, /createCustomerReturn\(req\.body \|\| \{\}, user\.id\)/u);
  assert.match(webhook, /parseCustomerReturnReferences\(rawText\)/u);
});
