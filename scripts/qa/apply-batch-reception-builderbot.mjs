import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the migrated, active demo bot. Never mutate the original support bot.
const projectId = '7fdf8f81-e227-4a04-8943-5402d3be4b15';
const apply = process.argv.includes('--apply');
const reboot = process.argv.includes('--reboot');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice(11);
if (!baseline || !/^[a-f0-9]{7,40}$/u.test(baseline)) throw new Error('Provide the verified --baseline=commit');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const source = await readFile(resolve(repo, 'docs/Prompt WMS.txt'), 'utf8');
const beforeSource = execFileSync('git', ['show', `${baseline}:docs/Prompt WMS.txt`], { cwd: repo, encoding: 'utf8' });
const hash = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\r\n/gu, '\n');
function section(prompt) {
  const start = prompt.indexOf('### 4C. AVANZAR_RECEPCION_GUIADA_OC');
  const end = prompt.indexOf('### 5. CONFIRMAR_RECEPCION_OC', start);
  if (start < 0 || end <= start) throw new Error('Missing guided reception section');
  return { start, end, text: prompt.slice(start, end) };
}
const desired = section(source).text;
const expected = section(beforeSource).text;
if (!desired.includes('params.avances') || !desired.includes('Ejemplo batch')) throw new Error('Batch instructions missing');
const env = await readFile(resolve('.env'), 'utf8');
const key = process.env.BUILDERBOT_MANAGER_API_KEY || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('BuilderBot Manager key unavailable');
async function flows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
    headers: { 'x-api-builderbot': key }, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Manager flows HTTP ${response.status}`);
  return (await response.json()).flows || [];
}
function target(all, name) {
  const matching = all.filter(flow => flow.name === name);
  if (matching.length !== 1) throw new Error(`Ambiguous flow ${name}`);
  const flow = matching[0];
  const answers = (flow.answers || []).filter(answer => typeof answer.plugins?.openai?.assistantInstructions === 'string');
  if (answers.length !== 1) throw new Error(`Ambiguous assistant ${name}`);
  const answer = answers[0];
  return { name, flowId: flow.id || flow.uuid, answerId: answer.id || answer.uuid,
    instructions: answer.plugins.openai.assistantInstructions };
}
function configuration(all) {
  // Fingerprint all settings/routing without logging tokens or HTTP headers.
  return hash(JSON.stringify(all.map(flow => ({ id: flow.id, name: flow.name, keyword: flow.keyword,
    options: flow.options, answers: (flow.answers || []).map(answer => ({ id: answer.id,
      type: answer.type, options: answer.options, rules: answer.rules,
      plugins: { ...answer.plugins, openai: answer.plugins?.openai
        ? Object.fromEntries(Object.entries(answer.plugins.openai).filter(([key]) => key !== 'assistantInstructions')) : null },
    })) }))));
}
const before = await flows();
const changes = ['Entrada', 'Voz'].map(name => {
  const saved = target(before, name);
  const current = section(saved.instructions);
  if (normalized(current.text) !== normalized(expected) && normalized(current.text) !== normalized(desired)) {
    throw new Error(`Live section ${name} diverged from verified baseline; refusing overwrite`);
  }
  return { ...saved, after: saved.instructions.slice(0, current.start) + desired + saved.instructions.slice(current.end) };
});
const describe = () => changes.map(change => ({ name: change.name,
  beforeSha256: hash(change.instructions), afterSha256: hash(change.after), changed: change.instructions !== change.after }));
if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', projectId, scope: 'only guided reception section', targets: describe() }));
  process.exit(0);
}
if (!changes.some(change => change.instructions !== change.after)) {
  console.log(JSON.stringify({ mode: 'already-current', projectId, targets: describe() }));
  process.exit(0);
}
const checkpoint = resolve('.tmp', 'builderbot-pre-batch-reception-20260928.json');
await writeFile(checkpoint, JSON.stringify({ projectId, capturedAt: new Date().toISOString(),
  configurationHash: configuration(before), prompts: changes.map(({ after, ...saved }) => saved) }, null, 2), { flag: 'wx' });

const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(), 55000);
const pending = new Map();
let resolveEndpoint;
const endpointReady = new Promise(resolvePromise => { resolveEndpoint = resolvePromise; });
let readLoop;
try {
  const stream = await fetch('https://bbc-mcp-http.builderbot.cloud/mcp/builderbot/sse', {
    headers: { 'x-builderbot-api-key': key, accept: 'text/event-stream' }, signal: abort.signal,
  });
  if (!stream.ok || !stream.body) throw new Error(`MCP SSE HTTP ${stream.status}`);
  const reader = stream.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  readLoop = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/gu, '');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = block.split('\n').find(row => row.startsWith('event:'))?.slice(6).trim();
        const data = block.split('\n').filter(row => row.startsWith('data:')).map(row => row.slice(5).trim()).join('\n');
        if (event === 'endpoint') resolveEndpoint(data);
        if (data.startsWith('{')) {
          const response = JSON.parse(data);
          if (pending.has(response.id)) { pending.get(response.id)(response); pending.delete(response.id); }
        }
      }
    }
  })();
  const endpoint = new URL(await endpointReady, 'https://bbc-mcp-http.builderbot.cloud');
  if (endpoint.origin !== 'https://bbc-mcp-http.builderbot.cloud') throw new Error('Unexpected MCP endpoint');
  async function send(id, method, params = {}) {
    const result = id == null ? null : new Promise(resolvePromise => pending.set(id, resolvePromise));
    const response = await fetch(endpoint, { method: 'POST',
      headers: { 'x-builderbot-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id == null ? {} : { id }), method, params }), signal: abort.signal });
    if (!response.ok) throw new Error(`MCP POST HTTP ${response.status}`);
    return result;
  }
  async function call(id, name, args) {
    const result = await send(id, 'tools/call', { name, arguments: args });
    if (result?.error || result?.result?.isError) throw new Error(`MCP ${name} rejected the operation`);
    return result;
  }
  await send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'wms-batch-reception-sync', version: '1.0.0' } });
  await send(null, 'notifications/initialized');
  let id = 2;
  for (const change of changes) {
    if (change.instructions === change.after) continue;
    await call(id++, 'builderbot_update_answer', { projectId, flowId: change.flowId,
      answerId: change.answerId, assistant: { instructions: change.after } });
  }
  await call(id++, 'builderbot_validate_bot', { projectId });
  if (reboot) await call(id++, 'builderbot_deploy', { projectId, action: 'reboot' });
} finally {
  clearTimeout(timeout);
  abort.abort();
  await readLoop?.catch(error => { if (error?.name !== 'AbortError') throw error; });
}
const after = await flows();
if (configuration(after) !== configuration(before)) throw new Error('Non-prompt bot configuration changed');
for (const change of changes) {
  if (target(after, change.name).instructions !== change.after) throw new Error(`Readback mismatch: ${change.name}`);
}
console.log(JSON.stringify({ mode: 'applied', projectId, rebootRequested: reboot,
  readbackMatches: true, configurationPreserved: true, checkpoint, targets: describe() }));
