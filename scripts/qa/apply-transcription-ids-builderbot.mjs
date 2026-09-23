import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectId = '5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d';
const apply = process.argv.includes('--apply');
const reboot = process.argv.includes('--reboot');
const restore = process.argv.includes('--restore');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const beforePrompt = execFileSync('git', ['show', 'bcebd1f:docs/Prompt WMS.txt'], {
  cwd: repo, encoding: 'utf8',
});
const afterPrompt = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const checkpoint = JSON.parse(await readFile(resolve('.tmp', 'builderbot-pre-ocid-transcription-20260923.json'), 'utf8'));
const env = await readFile(resolve('.env'), 'utf8');
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key || checkpoint.projectId !== projectId || checkpoint.prompts.length !== 2) {
  throw new Error('BuilderBot key or prompt checkpoint is unavailable');
}
const sha256 = value => createHash('sha256').update(value).digest('hex');

const substitutions = [
  ['8. Conserva códigos exactamente', '8. Conserva el mensaje real'],
  ['No requiere parámetros, no prepara una recepción', 'No requiere parámetros, no prepara una recepción'],
  ['Exige siempre el prefijo de tipo.', 'Exige siempre el TIPO de orden'],
  ['El PRIMER mensaje guiado debe contener el identificador', 'El PRIMER mensaje guiado debe contener un identificador'],
  ['Si usas orden_compra_id, el mensaje actual', 'Si usas orden_compra_id, el mensaje actual'],
  ['Acepta "Confirmo la recepcion OC ID N"', 'Acepta "Confirmo la recepcion OC ID N"'],
];
function lineStarting(prompt, start) {
  const matches = prompt.split(/\r?\n/u).filter(line => line.startsWith(start));
  if (matches.length !== 1) throw new Error(`Expected one prompt line starting ${start}`);
  return matches[0];
}
const changes = substitutions.map(([oldStart, newStart]) => ({
  oldLine: lineStarting(beforePrompt, oldStart),
  newLine: lineStarting(afterPrompt, newStart),
}));
const anchor = lineStarting(beforePrompt, '- Corrige errores fonéticos razonables');
const addedLine = lineStarting(afterPrompt, '- Las pausas de voz no definen el ID:');

function patchedPrompt(original) {
  let updated = original;
  for (const { oldLine, newLine } of changes) {
    if (updated.split(oldLine).length !== 2) throw new Error('A live prompt line has diverged');
    updated = updated.replace(oldLine, newLine);
  }
  if (updated.split(anchor).length !== 2) throw new Error('Prompt insertion anchor has diverged');
  return updated.replace(anchor, `${anchor}\n${addedLine}`);
}

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
    headers: { 'x-api-builderbot': key },
  });
  if (!response.ok) throw new Error(`BuilderBot Manager HTTP ${response.status}`);
  return (await response.json()).flows || [];
}

function target(flows, saved) {
  const flow = flows.find(item => (item.id || item.uuid) === saved.flowId && item.name === saved.name);
  const answer = flow?.answers?.find(item => (item.id || item.uuid) === saved.answerId);
  const instructions = answer?.plugins?.openai?.assistantInstructions;
  if (typeof instructions !== 'string') throw new Error(`Target prompt ${saved.name} changed shape`);
  return instructions;
}

const beforeFlows = await loadFlows();
const updates = checkpoint.prompts.map(saved => {
  const current = target(beforeFlows, saved);
  const patched = patchedPrompt(saved.instructions);
  if (current !== saved.instructions && current !== patched) {
    throw new Error(`Prompt ${saved.name} changed since checkpoint; refusing to overwrite it`);
  }
  return { saved, current, desired: restore ? saved.instructions : patched };
});

if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: restore ? 'restore-dry-run' : 'dry-run',
    prompts: updates.map(({ saved, current, desired }) => ({ name: saved.name,
      beforeSha256: sha256(current), afterSha256: sha256(desired),
      changed: current !== desired })) })}\n`);
  process.exit(0);
}

async function mcpSession(operation) {
  const abort = new AbortController();
  const pending = new Map();
  let resolveEndpoint;
  const endpointPromise = new Promise(resolve => { resolveEndpoint = resolve; });
  const stream = await fetch('https://bbc-mcp-http.builderbot.cloud/mcp/builderbot/sse', {
    headers: { 'x-builderbot-api-key': key, accept: 'text/event-stream' }, signal: abort.signal,
  });
  if (!stream.ok || !stream.body) throw new Error(`BuilderBot MCP SSE HTTP ${stream.status}`);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const readLoop = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = block.split('\n').filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim()).join('\n');
        if (event === 'endpoint') resolveEndpoint(data);
        if (data.startsWith('{')) {
          const message = JSON.parse(data);
          if (pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
          }
        }
      }
    }
  })();
  const endpoint = new URL(await endpointPromise, 'https://bbc-mcp-http.builderbot.cloud').toString();
  async function send(message, wait = true) {
    const result = wait ? new Promise(resolve => pending.set(message.id, resolve)) : null;
    const response = await fetch(endpoint, { method: 'POST',
      headers: { 'x-builderbot-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(message) });
    if (!response.ok) throw new Error(`BuilderBot MCP POST HTTP ${response.status}`);
    return result;
  }
  try {
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'wms-transcription-id-sync', version: '1.0.0' },
    } });
    await send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, false);
    return await operation(async (name, args, id) => {
      const result = await send({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name, arguments: args } });
      if (result?.error || result?.result?.isError) {
        throw new Error(`BuilderBot ${name} failed: ${JSON.stringify(result.error || result.result)}`);
      }
      return result;
    });
  } finally {
    abort.abort();
    await readLoop.catch(error => { if (error?.name !== 'AbortError') throw error; });
  }
}

await mcpSession(async call => {
  let id = 2;
  for (const update of updates) {
    if (update.current === update.desired) continue;
    await call('builderbot_update_answer', { projectId, flowId: update.saved.flowId,
      answerId: update.saved.answerId, assistant: { instructions: update.desired } }, id++);
  }
  if (reboot) await call('builderbot_deploy', { projectId, action: 'reboot' }, id++);
});
await new Promise(resolveDelay => setTimeout(resolveDelay, reboot ? 5000 : 1500));
const afterFlows = await loadFlows();
for (const update of updates) {
  if (target(afterFlows, update.saved) !== update.desired) {
    throw new Error(`Prompt readback mismatch for ${update.saved.name}`);
  }
}
process.stdout.write(`${JSON.stringify({ mode: restore ? 'restored' : 'applied',
  rebootRequested: reboot, prompts: updates.map(({ saved, desired }) => ({
    name: saved.name, sha256: sha256(desired),
  })) })}\n`);
