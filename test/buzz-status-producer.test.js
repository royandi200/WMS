'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildWmsStatusEvent,
  canonicalJson,
  validateBuzzEvent,
  validateManifest,
} = require('../scripts/buzz/wms-status-event');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_SHA256 = '3e41e11097174b79126761019d92e9b706361830b9a2b90846aedb8bbd9d677f';
const GIT = {
  commit: 'a'.repeat(40),
  committedAt: '2026-08-05T10:12:07-05:00',
};

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'buzz-status.json'), 'utf8'));
}

test('produces a Buzz 1.0 event from the pinned canonical contract', () => {
  const contractBytes = fs.readFileSync(path.join(ROOT, 'contracts', 'buzz-event-1.0.schema.json'));
  assert.equal(crypto.createHash('sha256').update(contractBytes).digest('hex'), CONTRACT_SHA256);

  const contract = JSON.parse(contractBytes);
  const event = buildWmsStatusEvent(manifest(), GIT);
  validateBuzzEvent(event);

  assert.equal(contract.$id, 'https://nobs.local/contracts/lamano-event-1.0.schema.json');
  assert.equal(event.schema_version, contract.properties.schema_version.const);
  assert.ok(contract.properties.event_type.enum.includes(event.event_type));
  assert.ok(contract.properties.status.enum.includes(event.status));
  assert.ok(contract.properties.sensitivity.enum.includes(event.sensitivity));
  assert.deepEqual(Object.keys(event).sort(), [...contract.required, 'payload'].sort());
  assert.equal(event.scope.project_id, 'la-mano');
  assert.equal(event.payload.model_cost_usd, 0);
});

test('keeps verified repository evidence separate from reported operational state', () => {
  const event = buildWmsStatusEvent(manifest(), GIT);
  assert.equal(event.evidence[0].confidence, 'verificado-repo');
  assert.equal(event.payload.test_state.confidence, 'verificado-repo');
  assert.equal(event.payload.siigo_state.confidence, 'reportado');
  assert.ok(event.payload.master_data_blockers.every((item) => item.confidence === 'reportado'));
  assert.match(event.payload.siigo_state.detail, /no consulto SIIGO/i);
});

test('is canonical, deterministic and idempotent across retries', () => {
  const first = buildWmsStatusEvent(manifest(), GIT);
  const second = buildWmsStatusEvent(manifest(), GIT);
  assert.equal(first.event_id, second.event_id);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.match(first.event_id, /^wms-status-[a-f0-9]{32}$/);
});

test('fails closed when manifest contains sensitive or unexpected fields', () => {
  const withPhone = manifest();
  withPhone.phone = '573001112233';
  assert.throws(() => validateManifest(withPhone), /campos no permitidos/);

  const withSecret = manifest();
  withSecret.evidence_key = 'secret=do-not-publish';
  assert.throws(() => validateManifest(withSecret), /referencia opaca/);

  const withInventory = manifest();
  withInventory.inventory = [{ sku: 'private', quantity: 100 }];
  assert.throws(() => buildWmsStatusEvent(withInventory, GIT), /campos no permitidos/);
});

test('fails closed on unverified tests, unknown blockers and invalid commits', () => {
  const failedTests = manifest();
  failedTests.test_state.status = 'failed';
  assert.throws(() => buildWmsStatusEvent(failedTests, GIT), /no esta aprobado/);

  const unknownBlocker = manifest();
  unknownBlocker.master_data_blockers[0] = 'unknown';
  assert.throws(() => buildWmsStatusEvent(unknownBlocker, GIT), /desconocidos/);

  assert.throws(() => buildWmsStatusEvent(manifest(), { ...GIT, commit: 'main' }), /no es verificable/);
});

test('the WMS producer exposes dry-run only and no network publication path', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'scripts', 'buzz', 'generate-wms-status-event.js'), 'utf8');
  const producer = fs.readFileSync(path.join(ROOT, 'scripts', 'buzz', 'wms-status-event.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const source = `${cli}\n${producer}`;

  assert.equal(packageJson.scripts['buzz:event:dry-run'], 'node scripts/buzz/generate-wms-status-event.js');
  assert.doesNotMatch(source, /require\(['"](?:https?|net|tls|axios|mysql2)['"]\)/);
  assert.doesNotMatch(source, /enqueue|publish-event|lamano_outbox|ssh/i);
  assert.match(cli, /debe permanecer dentro del repositorio WMS/);
});
