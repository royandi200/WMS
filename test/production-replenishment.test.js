const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildReplenishmentRequirements,
  normalizeReplenishmentInput,
  replenishmentCodeForId,
} = require('../api/_lib/production-replenishment');
const { capabilityForAction, CAPABILITIES } = require('../api/_lib/capabilities');

test('requires an explicit full BOM decision before preparing replenishment', () => {
  assert.throws(
    () => normalizeReplenishmentInput({ quantity: 1, reason: 'Unidad no conforme' }),
    error => error.status === 400 && /Confirma expresamente/u.test(error.message)
  );
  assert.deepEqual(
    normalizeReplenishmentInput({ quantity: '2', reason: ' dano de empaque ', fullBomConfirmed: true }),
    { units: 2, reason: 'dano de empaque' }
  );
});

test('rejects fractional, zero and missing replacement quantities', () => {
  for (const quantity of [undefined, 0, -1, 1.5]) {
    assert.throws(
      () => normalizeReplenishmentInput({ quantity, reason: 'Prueba', fullBomConfirmed: true }),
      error => error.status === 400 && /entero positivo/u.test(error.message)
    );
  }
});

test('builds stable human-readable replenishment codes', () => {
  assert.equal(replenishmentCodeForId(67, 3), 'REP-OP-000067-0003');
  assert.equal(replenishmentCodeForId(67, 3), replenishmentCodeForId(67, 3));
});

test('calculates replacement materials from the BOM snapshot stored on the order', () => {
  const result = buildReplenishmentRequirements([
    { sku: 'TARRO', cantidad_teorica: 3 },
    { sku: 'GOMAS', cantidad_teorica: 540 },
  ], 3, 1);
  assert.deepEqual(result.map(item => ({ sku: item.material.sku, required: item.required })), [
    { sku: 'TARRO', required: 1 },
    { sku: 'GOMAS', required: 180 },
  ]);
});

test('maps preparation to admin capability and confirmation to picker capability', () => {
  assert.equal(capabilityForAction('PREPARAR_REPOSICION_PRODUCCION'), CAPABILITIES.PRODUCTION_RELEASE);
  assert.equal(capabilityForAction('CANCELAR_REPOSICION_PRODUCCION'), CAPABILITIES.PRODUCTION_RELEASE);
  assert.equal(capabilityForAction('CONFIRMAR_REPOSICION_PRODUCCION'), CAPABILITIES.PRODUCTION_PICK);
});

test('keeps preparation and confirmation as separate transactional operations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/_lib/production-replenishment.js'), 'utf8');
  assert.match(source, /PENDIENTE_ALISTAMIENTO/u);
  assert.match(source, /stock SET reservada = reservada \+ \?/u);
  assert.match(source, /stock SET cantidad = cantidad - \?, reservada = reservada - \?/u);
  assert.match(source, /cantidad_adicional = cantidad_adicional \+ \?/u);
  assert.match(source, /already_prepared: true/u);
  assert.match(source, /already_confirmed: true/u);
  assert.match(source, /already_cancelled: true/u);
  assert.match(source, /WHERE id = \? AND confirmado_en IS NULL/u);
});

test('blocks closure while a replenishment reservation is pending', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/_lib/production-close.js'), 'utf8');
  assert.match(source, /PENDIENTE_ALISTAMIENTO/u);
  assert.match(source, /confirmala o cancelala antes de cerrar/u);
});

test('documents the two safe WhatsApp actions without exposing low-level lot entry', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  assert.match(prompt, /PREPARAR_REPOSICION_PRODUCCION/u);
  assert.match(prompt, /CONFIRMAR_REPOSICION_PRODUCCION/u);
  assert.match(prompt, /Nunca asumas que se repone el BOM completo/u);
  assert.match(prompt, /No pidas al alistador SKU, lote, ubicacion ni cantidades/u);
});
