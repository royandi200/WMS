const test = require('node:test');
const assert = require('node:assert/strict');
const { correctSpanishOrthography, formatWhatsAppMessage } = require('../api/_lib/whatsapp-message');

test('WhatsApp formatter separates top-level lines and keeps item details together', () => {
  assert.equal(
    formatWhatsAppMessage('Recepcion preparada\n- SKU-A\n  Lote LOT-A\nProveedor: 3Q'),
    'Recepción preparada\n\n- SKU-A\n  Lote LOT-A\n\nProveedor: 3Q'
  );
});

test('WhatsApp formatter is idempotent', () => {
  const message = 'Titulo\n\nLinea\n  detalle';
  assert.equal(formatWhatsAppMessage(formatWhatsAppMessage(message)), formatWhatsAppMessage(message));
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
