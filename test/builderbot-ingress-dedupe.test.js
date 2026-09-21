const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildIngressIdentity,
  claimIngress,
  cleanTemplateValue,
  extractTransportId,
  extractVoiceText,
  normalizeVoiceText,
} = require('../api/_lib/builderbot-ingress-dedupe');

class FakeDedupeDb {
  constructor() {
    this.rows = [];
    this.nextId = 1;
  }

  async execute(sql, args = []) {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.includes('WHERE request_key = ?')) {
      return [this.rows.filter(row => row.request_key === args[0]).slice(0, 1)];
    }
    if (sql.includes("identity_kind = 'VOICE_WINDOW'")) {
      return [this.rows.filter(row => row.identity_kind === 'VOICE_WINDOW'
        && row.actor_hash === args[0]
        && row.content_fingerprint === args[1]).slice(-1)];
    }
    if (sql.includes('INSERT INTO webhook_ingress_dedupe')) {
      const id = this.nextId++;
      this.rows.push({
        id,
        request_key: args[0],
        content_fingerprint: args[1],
        identity_kind: args[2],
        transport_id_hash: args[3],
        actor_hash: args[4],
        action: args[5],
        status: 'PENDING',
        duplicate_count: 0,
      });
      return [{ insertId: id }];
    }
    if (sql.includes('duplicate_count = duplicate_count + 1')) {
      const row = this.rows.find(item => item.id === args[0]);
      row.duplicate_count += 1;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`SQL no esperado: ${sql}`);
  }
}

test('ignora placeholders sin resolver y texto normal no activa la barrera temporal', () => {
  assert.equal(cleanTemplateValue('{aiVoice}'), '');
  assert.equal(extractVoiceText({ voice_text: '{aiVoice}', body: 'confirma orden 88' }, {}), '');
  assert.equal(buildIngressIdentity({
    req: { headers: {} }, rawBody: { body: 'confirma orden 88' }, info: {}, from: '573000000000',
  }), null);
});

test('un ID estable de transporte tiene precedencia sobre el contenido', () => {
  const req = { headers: { 'x-whatsapp-message-id': 'wamid.ABC123' } };
  assert.equal(extractTransportId(req, {}, {}), 'wamid.ABC123');
  const first = buildIngressIdentity({ req, rawBody: { body: 'uno' }, info: {}, from: '573000000000' });
  const replay = buildIngressIdentity({ req, rawBody: { body: 'dos' }, info: {}, from: '573000000000' });
  assert.equal(first.kind, 'TRANSPORT');
  assert.equal(first.requestKey, replay.requestKey);
  assert.notEqual(first.contentFingerprint, replay.contentFingerprint);
});

test('normaliza diferencias inocuas en la transcripción de voz', () => {
  assert.equal(normalizeVoiceText('  Vamos A  producir 3  '), 'vamos a producir 3');
  const first = buildIngressIdentity({
    req: { headers: {} }, rawBody: { voice_text: 'Vamos a producir 3' }, info: {}, from: '573014091681',
  });
  const replay = buildIngressIdentity({
    req: { headers: {} }, rawBody: { voice_text: '  VAMOS   A PRODUCIR 3 ' }, info: {}, from: '573014091681',
  });
  assert.equal(first.kind, 'VOICE_WINDOW');
  assert.equal(first.contentFingerprint, replay.contentFingerprint);
  assert.equal(first.windowSeconds, 15);
});

test('la misma voz de otro número no se considera duplicada', () => {
  const common = { req: { headers: {} }, rawBody: { voice_text: 'consulta stock' }, info: {} };
  const first = buildIngressIdentity({ ...common, from: '573014091681' });
  const other = buildIngressIdentity({ ...common, from: '573000000001' });
  assert.notEqual(first.contentFingerprint, other.contentFingerprint);
});

test('claimIngress deja pasar la primera voz y silencia la repetición', async () => {
  const db = new FakeDedupeDb();
  const identity = buildIngressIdentity({
    req: { headers: {} }, rawBody: { voice_text: 'crea una producción' }, info: {}, from: '573014091681',
  });
  const first = await claimIngress(db, identity, 'CREAR_PRODUCCION');
  const replay = await claimIngress(db, identity, 'CREAR_PRODUCCION');
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].duplicate_count, 1);
});

test('claimIngress deduplica un ID de transporte aun si cambia el contenido', async () => {
  const db = new FakeDedupeDb();
  const req = { headers: { 'idempotency-key': 'provider-event-77' } };
  const firstIdentity = buildIngressIdentity({ req, rawBody: { body: 'a' }, info: {}, from: '573014091681' });
  const replayIdentity = buildIngressIdentity({ req, rawBody: { body: 'b' }, info: {}, from: '573014091681' });
  const first = await claimIngress(db, firstIdentity, 'MODO_CHARLA');
  const replay = await claimIngress(db, replayIdentity, 'MODO_CHARLA');
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(db.rows.length, 1);
});

test('el webhook reclama la identidad antes de usuarios y operaciones de negocio', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/builderbot.js'),
    'utf8'
  );
  const claimIndex = source.indexOf('ingressClaim = await claimIngress');
  const userIndex = source.indexOf('const user     = await getOrCreateBotUser', claimIndex);
  const dispatchIndex = source.indexOf('switch (action)', claimIndex);
  assert.ok(claimIndex > 0);
  assert.ok(userIndex > claimIndex);
  assert.ok(dispatchIndex > claimIndex);
  assert.match(source.slice(claimIndex, userIndex), /if \(ingressClaim\.duplicate\)/u);
  assert.match(source.slice(claimIndex, userIndex), /message: ''/u);
});

