const test = require('node:test');
const assert = require('node:assert/strict');
const { formatWhatsAppMessage } = require('../api/_lib/whatsapp-message');

test('WhatsApp formatter separates top-level lines and keeps item details together', () => {
  assert.equal(
    formatWhatsAppMessage('Recepcion preparada\n- SKU-A\n  Lote LOT-A\nProveedor: 3Q'),
    'Recepcion preparada\n\n- SKU-A\n  Lote LOT-A\n\nProveedor: 3Q'
  );
});

test('WhatsApp formatter is idempotent', () => {
  const message = 'Titulo\n\nLinea\n  detalle';
  assert.equal(formatWhatsAppMessage(formatWhatsAppMessage(message)), formatWhatsAppMessage(message));
});
