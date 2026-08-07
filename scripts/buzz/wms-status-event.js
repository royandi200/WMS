'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const CONTRACT_FIELDS = new Set([
  'schema_version', 'event_id', 'event_type', 'occurred_at', 'producer',
  'scope', 'summary', 'status', 'sensitivity', 'evidence', 'payload',
  'data_ref', 'correlation_id', 'causation_id', 'review_on',
]);
const CONFIDENCES = new Set([
  'verificado-vivo', 'verificado-repo', 'reportado', 'inferido', 'pendiente',
]);
const SECRET_PATTERN = /(?:api[_ -]?key\s*[:=]|private[_ -]?key\s*[:=]|password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|bearer\s+[a-z0-9._-]+|token\s*[:=])/i;
const PII_PATTERN = /(?:\b\+?57\d{10}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
const SAFE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BLOCKERS = Object.freeze({
  bom_pending_client_validation: {
    area: 'bom',
    status: 'blocked',
    detail: 'BOM de productos terminados pendiente de validacion completa del cliente.',
  },
  units_pending_client_validation: {
    area: 'units',
    status: 'blocked',
    detail: 'Unidades de medida y conversiones pendientes de validacion del cliente.',
  },
  locations_pending_production_validation: {
    area: 'locations',
    status: 'blocked',
    detail: 'Ubicaciones productivas pendientes de confirmacion antes del arranque.',
  },
  users_pending_role_assignment: {
    area: 'users',
    status: 'blocked',
    detail: 'Usuarios operativos pendientes de asignacion y prueba por rol.',
  },
});

const SIIGO_STATES = Object.freeze({
  sandbox_flows_reported: {
    status: 'partially_verified',
    detail: 'El repositorio reporta pruebas sandbox de compras y ventas; esta corrida no consulto SIIGO ni establece obligaciones contractuales.',
  },
});

const NEXT_ACTIONS = Object.freeze({
  validate_master_data_and_assign_roles: 'Validar BOM, unidades y ubicaciones; asignar usuarios por rol antes de una prueba controlada.',
});

function fail(message) {
  throw new Error(`WMS Buzz producer: ${message}`);
}

function assertExactKeys(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} debe ser un objeto`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${field} contiene campos no permitidos: ${unknown.sort().join(', ')}`);
}

function assertSafeText(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    fail(`${field} debe ser texto no vacio de maximo ${maximum} caracteres`);
  }
  if (SECRET_PATTERN.test(value) || PII_PATTERN.test(value)) fail(`${field} contiene datos sensibles`);
}

function assertTimestamp(value, field) {
  assertSafeText(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(`${field} debe ser RFC3339 con zona horaria`);
  }
  if (Number.isNaN(Date.parse(value))) fail(`${field} no es una fecha valida`);
}

function validateManifest(manifest) {
  assertExactKeys(manifest, new Set([
    'schema_version', 'observed_at', 'test_state', 'master_data_blockers',
    'siigo_state', 'next_human_action', 'evidence_key',
  ]), 'manifest');
  if (manifest.schema_version !== '1.0') fail('schema_version del manifest debe ser 1.0');
  assertTimestamp(manifest.observed_at, 'manifest.observed_at');

  assertExactKeys(manifest.test_state, new Set(['status', 'source', 'confidence', 'passed']), 'test_state');
  if (manifest.test_state.status !== 'passed') fail('test_state.status no esta aprobado');
  if (manifest.test_state.source !== 'npm_test_local') fail('test_state.source no esta permitido');
  if (manifest.test_state.confidence !== 'verificado-repo') fail('test_state.confidence no esta permitido');
  if (!Number.isSafeInteger(manifest.test_state.passed) || manifest.test_state.passed < 1) fail('test_state.passed debe ser positivo');

  if (!Array.isArray(manifest.master_data_blockers) || manifest.master_data_blockers.length !== 4) {
    fail('master_data_blockers debe declarar exactamente los cuatro dominios requeridos');
  }
  const blockers = new Set(manifest.master_data_blockers);
  if (blockers.size !== 4 || [...blockers].some((code) => !BLOCKERS[code])) {
    fail('master_data_blockers contiene codigos desconocidos o duplicados');
  }

  assertExactKeys(manifest.siigo_state, new Set(['status', 'confidence']), 'siigo_state');
  if (!SIIGO_STATES[manifest.siigo_state.status]) fail('siigo_state.status no esta permitido');
  if (manifest.siigo_state.confidence !== 'reportado') fail('SIIGO debe conservar confianza reportado');
  if (!NEXT_ACTIONS[manifest.next_human_action]) fail('next_human_action no esta permitido');
  if (typeof manifest.evidence_key !== 'string' || !SAFE_KEY_PATTERN.test(manifest.evidence_key) || manifest.evidence_key.length > 80) {
    fail('evidence_key no es una referencia opaca valida');
  }
}

function resolveGitHead(repoRoot) {
  const options = { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  let commit;
  let committedAt;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], options).trim().toLowerCase();
    committedAt = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], options).trim();
  } catch {
    fail('no fue posible verificar el commit Git');
  }
  if (!/^[a-f0-9]{40}$/.test(commit)) fail('el commit Git verificado no es SHA-1');
  assertTimestamp(committedAt, 'git.committed_at');
  return { commit, committedAt };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function validateBuzzEvent(event) {
  assertExactKeys(event, CONTRACT_FIELDS, 'event');
  const required = ['schema_version', 'event_id', 'event_type', 'occurred_at', 'producer', 'scope', 'summary', 'status', 'sensitivity', 'evidence'];
  for (const key of required) if (!(key in event)) fail(`falta el campo contractual ${key}`);
  if (event.schema_version !== '1.0' || event.event_type !== 'agent.status') fail('version o tipo de evento no permitido');
  if (event.status !== 'blocked' || event.sensitivity !== 'internal') fail('estado o sensibilidad no permitidos');
  assertSafeText(event.event_id, 'event_id', 128);
  assertTimestamp(event.occurred_at, 'occurred_at');
  assertSafeText(event.summary, 'summary', 500);
  assertExactKeys(event.producer, new Set(['agent_id', 'runtime']), 'producer');
  assertExactKeys(event.scope, new Set(['project_id', 'community_id']), 'scope');
  if (event.producer.agent_id !== 'wms-status-l0' || event.producer.runtime !== 'deterministic-node') fail('identidad del productor no permitida');
  if (event.scope.project_id !== 'la-mano' || event.scope.community_id !== 'lamano-private') fail('scope no permitido');
  if (!Array.isArray(event.evidence) || event.evidence.length < 1) fail('evidence es obligatorio');
  for (const [index, item] of event.evidence.entries()) {
    assertExactKeys(item, new Set(['uri', 'observed_at', 'confidence', 'note']), `evidence[${index}]`);
    assertSafeText(item.uri, `evidence[${index}].uri`, 500);
    assertTimestamp(item.observed_at, `evidence[${index}].observed_at`);
    if (!CONFIDENCES.has(item.confidence)) fail(`evidence[${index}].confidence no permitido`);
    if (item.note !== undefined) assertSafeText(item.note, `evidence[${index}].note`, 500);
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) fail('payload debe ser objeto');
  assertExactKeys(event.payload, new Set([
    'repository', 'test_state', 'master_data_blockers', 'siigo_state',
    'next_human_action', 'evidence_ref', 'model_cost_usd',
  ]), 'payload');
  assertExactKeys(event.payload.repository, new Set(['commit', 'verification']), 'payload.repository');
  assertExactKeys(event.payload.test_state, new Set([
    'status', 'observed_at', 'source', 'confidence', 'passed',
  ]), 'payload.test_state');
  assertExactKeys(event.payload.siigo_state, new Set(['status', 'confidence', 'detail']), 'payload.siigo_state');
  if (!Array.isArray(event.payload.master_data_blockers) || event.payload.master_data_blockers.length !== 4) {
    fail('payload.master_data_blockers no cumple el contrato WMS');
  }
  for (const [index, blocker] of event.payload.master_data_blockers.entries()) {
    assertExactKeys(blocker, new Set(['area', 'status', 'detail', 'confidence']), `payload.master_data_blockers[${index}]`);
  }
  const payloadText = JSON.stringify(event.payload);
  if (payloadText.length > 4000 || SECRET_PATTERN.test(payloadText) || PII_PATTERN.test(payloadText)) fail('payload no supera sanitizacion');
  if (event.payload.model_cost_usd !== 0) fail('model_cost_usd debe ser 0');
}

function buildWmsStatusEvent(manifest, gitHead) {
  validateManifest(manifest);
  if (!gitHead || !/^[a-f0-9]{40}$/.test(gitHead.commit || '')) fail('gitHead.commit no es verificable');
  assertTimestamp(gitHead.committedAt, 'gitHead.committedAt');

  const siigo = SIIGO_STATES[manifest.siigo_state.status];
  const eventWithoutId = {
    schema_version: '1.0',
    event_type: 'agent.status',
    occurred_at: manifest.observed_at,
    producer: { agent_id: 'wms-status-l0', runtime: 'deterministic-node' },
    scope: { project_id: 'la-mano', community_id: 'lamano-private' },
    summary: 'WMS requiere completar datos maestros y asignaciones humanas antes del arranque controlado.',
    status: 'blocked',
    sensitivity: 'internal',
    evidence: [
      {
        uri: `wms-evidence://git/${gitHead.commit}`,
        observed_at: gitHead.committedAt,
        confidence: 'verificado-repo',
        note: 'Commit resuelto localmente desde Git HEAD; no implica despliegue.',
      },
      {
        uri: `wms-evidence://${manifest.evidence_key}/tests`,
        observed_at: manifest.observed_at,
        confidence: manifest.test_state.confidence,
        note: 'Pruebas unitarias locales seguras; no se consultaron servicios vivos.',
      },
      {
        uri: `wms-evidence://${manifest.evidence_key}/siigo`,
        observed_at: manifest.observed_at,
        confidence: manifest.siigo_state.confidence,
        note: 'Estado tomado de documentacion versionada; no revalidado contra SIIGO.',
      },
    ],
    payload: {
      repository: { commit: gitHead.commit, verification: 'git-head' },
      test_state: {
        status: manifest.test_state.status,
        observed_at: manifest.observed_at,
        source: manifest.test_state.source,
        confidence: manifest.test_state.confidence,
        passed: manifest.test_state.passed,
      },
      master_data_blockers: manifest.master_data_blockers.map((code) => ({
        ...BLOCKERS[code],
        confidence: 'reportado',
      })),
      siigo_state: {
        status: siigo.status,
        confidence: manifest.siigo_state.confidence,
        detail: siigo.detail,
      },
      next_human_action: NEXT_ACTIONS[manifest.next_human_action],
      evidence_ref: `wms-evidence://${manifest.evidence_key}`,
      model_cost_usd: 0,
    },
  };
  const digest = crypto.createHash('sha256').update(canonicalJson(eventWithoutId)).digest('hex');
  const event = { ...eventWithoutId, event_id: `wms-status-${digest.slice(0, 32)}` };
  validateBuzzEvent(event);
  return canonicalize(event);
}

module.exports = {
  buildWmsStatusEvent,
  canonicalJson,
  resolveGitHead,
  validateBuzzEvent,
  validateManifest,
};
