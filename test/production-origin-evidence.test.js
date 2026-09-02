const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  productionOriginEvidence,
  resolveProductionOrigin,
} = require('../api/_lib/production-origin-evidence');

test('recognizes explicit stock and customer-order destinations', () => {
  assert.equal(productionOriginEvidence('Vamos a producir 4 tarros para stock de seguridad'), 'STOCK_SEGURIDAD');
  assert.equal(productionOriginEvidence('Es para reponer inventario'), 'STOCK_SEGURIDAD');
  assert.equal(productionOriginEvidence('Produzcamos 4 para un pedido de cliente'), 'OC_CLIENTE');
  assert.equal(productionOriginEvidence('Es para cumplir la OC del cliente'), 'OC_CLIENTE');
});

test('does not infer a destination from an ordinary production request', () => {
  assert.equal(productionOriginEvidence('Vamos a producir cuatro tarros de ashwagandha 60'), null);
  assert.throws(
    () => resolveProductionOrigin('Vamos a producir cuatro tarros de ashwagandha 60', 'STOCK_SEGURIDAD'),
    error => error.status === 400 && /No se creo la orden ni se reservo inventario/u.test(error.message)
  );
});

test('rejects ambiguous and contradictory origin interpretations', () => {
  assert.throws(
    () => resolveProductionOrigin('Es para stock de seguridad y para un pedido de cliente', 'STOCK_SEGURIDAD'),
    error => error.status === 400
  );
  assert.throws(
    () => resolveProductionOrigin('Es para stock de seguridad', 'OC_CLIENTE'),
    error => error.status === 400 && /no coincide/u.test(error.message)
  );
});

test('derives the origin from user evidence instead of requiring the model field', () => {
  assert.equal(resolveProductionOrigin('Para stock de seguridad', undefined), 'STOCK_SEGURIDAD');
  assert.equal(resolveProductionOrigin('Para pedido normal', undefined), 'OC_CLIENTE');
});

test('webhook enforces origin evidence before creating or reserving production', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  assert.match(source, /const originType = resolveProductionOrigin\(contractUserText, params\.origen_tipo\);[\s\S]*releaseProductionOrder\(\{/u);
  assert.match(source, /originType,/u);
  assert.match(source, /function getContractUserText\(rawBody, info\)[\s\S]*info\.body[\s\S]*info\.text[\s\S]*info\.query/u);
  assert.doesNotMatch(
    source.match(/function getContractUserText[\s\S]*?\n\}/u)?.[0] || '',
    /info\.(?:message|mensaje|texto|content)/u
  );
});

test('BuilderBot prompt forbids defaulting a missing production destination', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  assert.match(prompt, /Nunca infieras, completes por defecto ni inventes `origen_tipo`/u);
  assert.match(prompt, /La ausencia de destino nunca significa `STOCK_SEGURIDAD`/u);
  assert.match(prompt, /no emitas `LIBERAR_ORDEN_PRODUCCION`/u);
});
