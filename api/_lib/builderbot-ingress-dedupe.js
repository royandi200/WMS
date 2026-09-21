const { createHash, createHmac } = require('crypto');

const DEFAULT_VOICE_WINDOW_SECONDS = 15;
const MIN_VOICE_WINDOW_SECONDS = 2;
const MAX_VOICE_WINDOW_SECONDS = 30;

function cleanTemplateValue(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || /^\{[^{}]+\}$/u.test(normalized)) return '';
  return normalized;
}

function firstClean(values) {
  for (const value of values) {
    const clean = cleanTemplateValue(value);
    if (clean) return clean;
  }
  return '';
}

function collectExactKeys(value, acceptedKeys, output, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectExactKeys(item, acceptedKeys, output, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = String(key).replace(/[^a-z0-9]/giu, '').toLowerCase();
    if (acceptedKeys.has(normalizedKey)) output.push(child);
    if (child && typeof child === 'object') {
      collectExactKeys(child, acceptedKeys, output, depth + 1);
    }
  }
}

function extractTransportId(req, rawBody, info) {
  const headers = req?.headers || {};
  const headerCandidates = [
    headers['idempotency-key'],
    headers['x-idempotency-key'],
    headers['x-message-id'],
    headers['x-whatsapp-message-id'],
    headers['x-event-id'],
  ];
  const nestedCandidates = [];
  collectExactKeys(
    { rawBody, info },
    new Set(['messageid', 'wamid', 'eventid', 'transportid', 'idempotencykey']),
    nestedCandidates
  );
  return firstClean([...headerCandidates, ...nestedCandidates]);
}

function extractVoiceText(rawBody, info) {
  return firstClean([
    rawBody?.voice_text,
    rawBody?.voiceText,
    rawBody?.aiVoice,
    rawBody?.ai_voice,
    info?.voice_text,
    info?.voiceText,
    info?.aiVoice,
    info?.ai_voice,
  ]);
}

function normalizeVoiceText(value) {
  return cleanTemplateValue(value)
    .normalize('NFKC')
    .toLocaleLowerCase('es-CO')
    .replace(/\s+/gu, ' ')
    .trim();
}

function digest(value) {
  const secret = cleanTemplateValue(process.env.WEBHOOK_DEDUPE_SECRET);
  if (secret) return createHmac('sha256', secret).update(String(value)).digest('hex');
  return createHash('sha256').update(String(value)).digest('hex');
}

function voiceWindowSeconds() {
  const configured = Number(process.env.BUILDERBOT_VOICE_DEDUPE_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_VOICE_WINDOW_SECONDS;
  return Math.max(MIN_VOICE_WINDOW_SECONDS, Math.min(MAX_VOICE_WINDOW_SECONDS, Math.trunc(configured)));
}

function buildIngressIdentity({ req, rawBody, info, from }) {
  const transportId = extractTransportId(req, rawBody, info);
  const actorHash = digest(`actor:${cleanTemplateValue(from) || 'unknown'}`);
  if (transportId) {
    const transportHash = digest(`transport:${transportId}`);
    return {
      kind: 'TRANSPORT',
      requestKey: transportHash,
      contentFingerprint: digest(`payload:${JSON.stringify(rawBody || {})}`),
      transportIdHash: transportHash,
      actorHash,
      windowSeconds: null,
    };
  }

  const voiceText = normalizeVoiceText(extractVoiceText(rawBody, info));
  if (!voiceText) return null;
  return {
    kind: 'VOICE_WINDOW',
    requestKey: null,
    contentFingerprint: digest(`voice:${actorHash}:${voiceText}`),
    transportIdHash: null,
    actorHash,
    windowSeconds: voiceWindowSeconds(),
  };
}

function lockName(identity) {
  return `wms-bb-${identity.kind === 'TRANSPORT' ? identity.requestKey : identity.contentFingerprint}`.slice(0, 64);
}

async function claimIngress(db, identity, action) {
  if (!identity) return { protected: false, duplicate: false, id: null, identity: null };
  const lock = lockName(identity);
  const [[lockResult]] = await db.execute('SELECT GET_LOCK(?, 5) AS acquired', [lock]);
  if (Number(lockResult?.acquired) !== 1) {
    const err = new Error('No fue posible serializar el ingreso de BuilderBot');
    err.status = 503;
    throw err;
  }

  try {
    let rows;
    if (identity.kind === 'TRANSPORT') {
      [rows] = await db.execute(
        `SELECT id, status, duplicate_count
           FROM webhook_ingress_dedupe
          WHERE request_key = ?
          LIMIT 1`,
        [identity.requestKey]
      );
    } else {
      [rows] = await db.execute(
        `SELECT id, status, duplicate_count
           FROM webhook_ingress_dedupe
          WHERE identity_kind = 'VOICE_WINDOW'
            AND actor_hash = ?
            AND content_fingerprint = ?
            AND first_seen_at >= DATE_SUB(NOW(), INTERVAL ${identity.windowSeconds} SECOND)
          ORDER BY id DESC
          LIMIT 1`,
        [identity.actorHash, identity.contentFingerprint]
      );
    }

    if (rows.length) {
      await db.execute(
        `UPDATE webhook_ingress_dedupe
            SET duplicate_count = duplicate_count + 1,
                last_seen_at = NOW()
          WHERE id = ?`,
        [rows[0].id]
      );
      return { protected: true, duplicate: true, id: rows[0].id, identity };
    }

    const [insert] = await db.execute(
      `INSERT INTO webhook_ingress_dedupe
         (request_key, content_fingerprint, identity_kind, transport_id_hash,
          actor_hash, action, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        identity.requestKey,
        identity.contentFingerprint,
        identity.kind,
        identity.transportIdHash,
        identity.actorHash,
        String(action || 'UNKNOWN').slice(0, 80),
      ]
    );
    return { protected: true, duplicate: false, id: insert.insertId, identity };
  } finally {
    await db.execute('SELECT RELEASE_LOCK(?) AS released', [lock]).catch(() => {});
  }
}

async function completeIngress(db, claim, action) {
  if (!claim?.id || claim.duplicate) return;
  await db.execute(
    `UPDATE webhook_ingress_dedupe
        SET status = 'PROCESSED', completed_at = NOW(), last_seen_at = NOW(),
            response_meta = ?
      WHERE id = ?`,
    [JSON.stringify({ ok: true, action: String(action || 'UNKNOWN').slice(0, 80) }), claim.id]
  );
}

async function failIngress(db, claim, action, error) {
  if (!claim?.id || claim.duplicate) return;
  await db.execute(
    `UPDATE webhook_ingress_dedupe
        SET status = 'ERROR', completed_at = NOW(), last_seen_at = NOW(),
            response_meta = ?
      WHERE id = ?`,
    [JSON.stringify({ ok: false, action: String(action || 'UNKNOWN').slice(0, 80), error: String(error || 'Error').slice(0, 200) }), claim.id]
  );
}

module.exports = {
  buildIngressIdentity,
  claimIngress,
  cleanTemplateValue,
  completeIngress,
  extractTransportId,
  extractVoiceText,
  failIngress,
  normalizeVoiceText,
  voiceWindowSeconds,
};

