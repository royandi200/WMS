const { createHash, createHmac, randomUUID } = require('crypto');

const INBOX_SCHEMA_VERSION = 1;

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function digest(value) {
  const secret = clean(process.env.WEBHOOK_DEDUPE_SECRET);
  if (secret) return createHmac('sha256', secret).update(String(value)).digest('hex');
  return createHash('sha256').update(String(value)).digest('hex');
}

function jsonStringify(value) {
  return JSON.stringify(value ?? null, (_key, child) => (
    typeof child === 'bigint' ? child.toString() : child
  ));
}

function safeInboxError(error) {
  const status = Number(error?.status || 0);
  const code = clean(error?.code).toUpperCase();
  if (status >= 400 && status < 500) {
    return clean(error?.message || 'REQUEST_REJECTED').slice(0, 500);
  }
  if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code)) return code;
  return 'INTERNAL_ERROR';
}

function buildInboxRecord({ identity, rawBody, info, from, action, priority }) {
  const payload = {
    schema_version: INBOX_SCHEMA_VERSION,
    source: 'BUILDERBOT',
    raw_body: rawBody || {},
    parsed_info: info || {},
  };
  const payloadJson = jsonStringify(payload);
  const actorHash = identity?.actorHash || digest(`actor:${clean(from) || 'unknown'}`);
  const contentFingerprint = identity?.contentFingerprint || digest(`payload:${payloadJson}`);

  return {
    eventUuid: randomUUID(),
    identityKind: identity?.kind || 'UNPROTECTED',
    actorHash,
    contentFingerprint,
    action: clean(action || 'UNKNOWN').slice(0, 80) || 'UNKNOWN',
    priority: clean(priority || 'baja').slice(0, 20) || 'baja',
    payloadJson,
  };
}

async function createInboxEvent(db, input) {
  const record = buildInboxRecord(input);
  const [insert] = await db.execute(
    `INSERT INTO webhook_ingress_inbox
       (event_uuid, identity_kind, actor_hash, content_fingerprint,
        action, priority, status, attempt_count, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', 0, ?)`,
    [
      record.eventUuid,
      record.identityKind,
      record.actorHash,
      record.contentFingerprint,
      record.action,
      record.priority,
      record.payloadJson,
    ]
  );
  return { id: insert.insertId, ...record };
}

async function startInboxProcessing(db, inbox, claim) {
  if (!inbox?.id) return;
  await db.execute(
    `UPDATE webhook_ingress_inbox
        SET status = 'PROCESSING', dedupe_id = ?, attempt_count = attempt_count + 1,
            processing_started_at = NOW(3), updated_at = NOW(3)
      WHERE id = ?`,
    [claim?.id || null, inbox.id]
  );
}

async function markInboxDuplicate(db, inbox, claim) {
  if (!inbox?.id) return;
  const response = {
    duplicate: true,
    identity_kind: claim?.identity?.kind || inbox.identityKind,
    dedupe_id: claim?.id || null,
  };
  await db.execute(
    `UPDATE webhook_ingress_inbox
        SET status = 'DUPLICATE', dedupe_id = ?, response_json = ?,
            completed_at = NOW(3), updated_at = NOW(3),
            duration_ms = TIMESTAMPDIFF(MICROSECOND, received_at, NOW(3)) / 1000
      WHERE id = ?`,
    [claim?.id || null, jsonStringify(response), inbox.id]
  );
}

async function completeInboxEvent(db, inbox, response) {
  if (!inbox?.id) return;
  await db.execute(
    `UPDATE webhook_ingress_inbox
        SET status = 'PROCESSED', response_json = ?, last_error = NULL,
            completed_at = NOW(3), updated_at = NOW(3),
            duration_ms = TIMESTAMPDIFF(MICROSECOND, received_at, NOW(3)) / 1000
      WHERE id = ?`,
    [jsonStringify(response || {}), inbox.id]
  );
}

async function failInboxEvent(db, inbox, error) {
  if (!inbox?.id) return;
  const message = safeInboxError(error);
  await db.execute(
    `UPDATE webhook_ingress_inbox
        SET status = 'FAILED', last_error = ?,
            completed_at = NOW(3), updated_at = NOW(3),
            duration_ms = TIMESTAMPDIFF(MICROSECOND, received_at, NOW(3)) / 1000
      WHERE id = ?`,
    [message, inbox.id]
  );
}

module.exports = {
  INBOX_SCHEMA_VERSION,
  buildInboxRecord,
  completeInboxEvent,
  createInboxEvent,
  failInboxEvent,
  markInboxDuplicate,
  safeInboxError,
  startInboxProcessing,
};
