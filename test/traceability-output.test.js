const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('lot traceability exposes production result and both waste contexts', () => {
  const webhook = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8'
  );
  assert.match(webhook, /\*Produccion \/ resultado:\*/u);
  assert.match(webhook, /\*Mermas asociadas:\*/u);
  assert.match(webhook, /uso productivo estimado/u);
  assert.match(webhook, /m\.referencia_externa \? `proceso/u);
  assert.match(webhook, /\['CIERRE_PRODUCCION', 'INGRESO_RECEPCION'\]\.includes\(k\.action\) && k\.ubicacion_codigo/u);
});
