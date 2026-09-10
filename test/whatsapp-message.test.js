const test = require('node:test');
const assert = require('node:assert/strict');
const {
  correctSpanishOrthography,
  decorateOperationalMessage,
  emphasizeProcessIds,
  formatWhatsAppMessage,
} = require('../api/_lib/whatsapp-message');

test('WhatsApp formatter separates top-level lines and keeps item details together', () => {
  assert.equal(
    formatWhatsAppMessage('Recepcion preparada\n- SKU-A\n  Lote LOT-A\nProveedor: 3Q'),
    '📥 ⏳ Recepción preparada\n\n- SKU-A\n  Lote LOT-A\n\nProveedor: 3Q'
  );
});

test('WhatsApp formatter is idempotent', () => {
  const message = 'Titulo\n\nOrden: OP ID 88\n  detalle';
  assert.equal(formatWhatsAppMessage(formatWhatsAppMessage(message)), formatWhatsAppMessage(message));
});

test('WhatsApp formatter emphasizes short process IDs without duplicating existing bold', () => {
  assert.equal(emphasizeProcessIds('OC ID 28'), '*OC ID 28*');
  assert.equal(emphasizeProcessIds('Recepción para ID 3Q-17'), 'Recepción para *ID 3Q-17*');
  assert.equal(emphasizeProcessIds('*DSP ID 3Q-17 | REM-3Q-17*'), '*DSP ID 3Q-17 | REM-3Q-17*');

  const formatted = formatWhatsAppMessage([
    'Recepción: OC ID 28',
    'Maquila: MQ ID 16',
    'In & Out: IO ID 7',
    'Producción: OP ID 88',
    'Despacho: DSP ID 3Q-17',
  ].join('\n'));
  for (const id of ['OC ID 28', 'MQ ID 16', 'IO ID 7', 'OP ID 88', 'DSP ID 3Q-17']) {
    assert.match(formatted, new RegExp(`\\*${id}\\*`, 'u'));
  }
  assert.doesNotMatch(formatted, /\*\*/u);
});

test('WhatsApp formatter uses operational emojis and reserves checkmarks for completed states', () => {
  const pendingCases = [
    ['Recepciones pendientes (1)', '📥 ⏳ Recepciones pendientes (1)'],
    ['Recepción preparada para OC ID 28', '📥 ⏳ Recepción preparada para OC ID 28'],
    ['Nueva orden de producción OP ID 88', '🏭 Nueva orden de producción OP ID 88'],
    ['Despachos pendientes (1)', '🚚 ⏳ Despachos pendientes (1)'],
    ['Salida a maquila 3Q preparada', '🚚 ⏳ Salida a maquila 3Q preparada'],
  ];
  for (const [input, expected] of pendingCases) {
    const decorated = decorateOperationalMessage(input);
    assert.equal(decorated, expected);
    assert.doesNotMatch(decorated, /✅/u);
  }

  assert.equal(decorateOperationalMessage('Recepción confirmada'), '📥 ✅ Recepción confirmada');
  assert.equal(decorateOperationalMessage('Producción cerrada: OP ID 88'), '🏭 ✅ Producción cerrada: OP ID 88');
  assert.equal(decorateOperationalMessage('Despacho confirmado'), '🚚 ✅ Despacho confirmado');
  assert.equal(decorateOperationalMessage('No hay recepciones pendientes'), '📥 No hay recepciones pendientes');
  assert.equal(decorateOperationalMessage('🏭 Producción cerrada'), '🏭 ✅ Producción cerrada');
  assert.equal(decorateOperationalMessage('✅ Orden OP-88 APROBADA'), '🏭 ✅ Orden OP-88 APROBADA');
  assert.equal(
    decorateOperationalMessage('*Nueva orden para alistamiento*\nOrden: OP ID 88'),
    '🏭 *Nueva orden para alistamiento*\nOrden: OP ID 88'
  );
  assert.doesNotMatch(
    decorateOperationalMessage('*Nueva orden para alistamiento*\nOrden: OP ID 88'),
    /✅/u
  );
});

test('WhatsApp formatter corrects common Spanish copy without changing identifiers', () => {
  assert.equal(
    correctSpanishOrthography('RECEPCION OC ID 28 confirmada. No se modifico inventario. Ubicacion: A1.'),
    'RECEPCIÓN OC ID 28 confirmada. No se modificó inventario. Ubicación: A1.'
  );
  assert.equal(
    correctSpanishOrthography('Confirmo la recepcion OC ID 28. ¿Que necesitas?'),
    'Confirmo la recepción OC ID 28. ¿Qué necesitas?'
  );
  assert.equal(
    correctSpanishOrthography('INGRESO_RECEPCION, recepcion_id y DEMO-RECEPCION-001'),
    'INGRESO_RECEPCION, recepcion_id y DEMO-RECEPCION-001'
  );
});
