const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildInboxRecord,
  completeInboxEvent,
  createInboxEvent,
  failInboxEvent,
  markInboxDuplicate,
  safeInboxError,
  startInboxProcessing,
} = require('../api/_lib/builderbot-durable-inbox');

class FakeInboxDb {
  constructor() {
    this.calls = [];
  }

  async execute(sql, args = []) {
    this.calls.push({ sql, args });
    if (sql.includes('INSERT INTO webhook_ingress_inbox')) return [{ insertId: 71 }];
    return [{ affectedRows: 1 }];
  }
}

test('crea un sobre durable aun cuando no hay identidad de transporte', async () => {
  const db = new FakeInboxDb();
  const event = await createInboxEvent(db, {
    identity: null,
    rawBody: { body: 'consulta stock', from: '573000000000' },
    info: { action: 'CONSULTAR_STOCK_MATERIA_PRIMA' },
    from: '573000000000',
    action: 'CONSULTAR_STOCK_MATERIA_PRIMA',
    priority: 'baja',
  });

  assert.equal(event.id, 71);
  assert.equal(event.identityKind, 'UNPROTECTED');
  assert.equal(event.actorHash.length, 64);
  assert.equal(event.contentFingerprint.length, 64);
  assert.match(event.eventUuid, /^[0-9a-f-]{36}$/u);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /status, attempt_count, payload_json/u);
  const envelope = JSON.parse(db.calls[0].args.at(-1));
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.source, 'BUILDERBOT');
  assert.equal(envelope.raw_body.body, 'consulta stock');
  assert.equal(envelope.parsed_info.action, 'CONSULTAR_STOCK_MATERIA_PRIMA');
});

test('preserva las huellas de una identidad protegida', () => {
  const record = buildInboxRecord({
    identity: {
      kind: 'TRANSPORT',
      actorHash: 'a'.repeat(64),
      contentFingerprint: 'b'.repeat(64),
    },
    rawBody: { body: 'x' },
    info: {},
    from: '573000000000',
    action: 'MODO_CHARLA',
    priority: 'media',
  });
  assert.equal(record.identityKind, 'TRANSPORT');
  assert.equal(record.actorHash, 'a'.repeat(64));
  assert.equal(record.contentFingerprint, 'b'.repeat(64));
});

test('registra el ciclo processing, processed, duplicate y failed', async () => {
  const db = new FakeInboxDb();
  const inbox = { id: 9, identityKind: 'VOICE_WINDOW' };
  const claim = { id: 5, identity: { kind: 'VOICE_WINDOW' } };

  await startInboxProcessing(db, inbox, claim);
  await completeInboxEvent(db, inbox, { ok: true, message: 'listo' });
  await markInboxDuplicate(db, inbox, claim);
  await failInboxEvent(db, inbox, Object.assign(new Error('fallo controlado'), { status: 400 }));

  assert.match(db.calls[0].sql, /status = 'PROCESSING'/u);
  assert.match(db.calls[1].sql, /status = 'PROCESSED'/u);
  assert.match(db.calls[2].sql, /status = 'DUPLICATE'/u);
  assert.match(db.calls[3].sql, /status = 'FAILED'/u);
  assert.equal(db.calls[3].args[0], 'fallo controlado');
});

test('no persiste detalles internos de errores inesperados', () => {
  assert.equal(safeInboxError(new Error('SQL con credencial sensible')), 'INTERNAL_ERROR');
  assert.equal(safeInboxError({ code: 'ER_LOCK_DEADLOCK' }), 'ER_LOCK_DEADLOCK');
  assert.equal(safeInboxError({ status: 422, message: 'Dato inválido' }), 'Dato inválido');
});

test('el webhook persiste en la bandeja antes de deduplicar y operar', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/builderbot.js'),
    'utf8'
  );
  const createIndex = source.indexOf('inboxEvent = await createInboxEvent');
  const claimIndex = source.indexOf('ingressClaim = await claimIngress', createIndex);
  const userIndex = source.indexOf('const user     = await getOrCreateBotUser', createIndex);
  assert.ok(createIndex > 0);
  assert.ok(claimIndex > createIndex);
  assert.ok(userIndex > claimIndex);
  assert.match(source, /await markInboxDuplicate\(db, inboxEvent, ingressClaim\)/u);
  assert.match(source, /await completeInboxEvent\(db, inboxEvent, successBody\)/u);
  assert.match(source, /await failInboxEvent\(db, inboxEvent, err\)/u);
});

test('el webhook responde de forma controlada si falla la conexión inicial', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/builderbot.js'),
    'utf8'
  );
  const dbDeclarationIndex = source.indexOf('let db = null;');
  const tryIndex = source.indexOf('try {', dbDeclarationIndex);
  const dbConnectionIndex = source.indexOf('db = await DB();', tryIndex);
  const catchIndex = source.indexOf('} catch (err) {', dbConnectionIndex);

  assert.ok(dbDeclarationIndex > 0);
  assert.ok(tryIndex > dbDeclarationIndex);
  assert.ok(dbConnectionIndex > tryIndex);
  assert.ok(catchIndex > dbConnectionIndex);
  assert.match(source, /const databaseUnavailable = !db;/u);
  assert.match(source, /if \(db\) \{[\s\S]*await failIngress/u);
  assert.match(source, /if \(db\) await db\.end\(\)\.catch/u);
  assert.match(source, /No pude conectar con el WMS\. Intenta nuevamente en unos segundos\./u);
});

test('el monitor no expone payloads y exige rol operativo alto', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/monitor.js'),
    'utf8'
  );
  assert.match(source, /requireRole\(req, \['Admin', 'Supervisor'\]\)/u);
  assert.doesNotMatch(source, /SELECT[^;]*payload_json/isu);
  assert.match(source, /recent_failures/u);
});
