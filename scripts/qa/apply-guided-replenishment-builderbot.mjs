import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectId = '5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d';
const copyFix = process.argv.includes('--copy-fix');
const backupPath = resolve('.tmp', copyFix
  ? 'builderbot-pre-guided-replenishment-copy-fix-20260923.json'
  : 'builderbot-pre-guided-replenishment-20260923.json');
const checkpoint = JSON.parse(await readFile(backupPath, 'utf8'));
const local = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');
const reboot = process.argv.includes('--reboot');
if (reboot && !apply) throw new Error('--reboot requires --apply');
if (checkpoint.projectId !== projectId || checkpoint.prompts.length !== 2) {
  throw new Error('The BuilderBot checkpoint does not match the intended project');
}

const env = await readFile(resolve('.env'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('BuilderBot Manager API key is unavailable');

const sectionStart = '### 7G. GUIAR_REPOSICION_PRODUCCION | media y alta al confirmar';
const sectionEnd = '### 7A. PREPARAR_REPOSICION_PRODUCCION | alta';
const start = local.indexOf(sectionStart);
const end = local.indexOf(sectionEnd, start);
if (start < 0 || end < 0) throw new Error('The local guided section is missing');
const guidedSection = local.slice(start, end);
const opHint = local.split(/\r?\n/u).find(line => line.startsWith('- En producción, transcripciones como'));
if (!opHint) throw new Error('The local OP transcription hint is missing');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function patchedPrompt(original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  if (original.split(sectionEnd).length !== 2) throw new Error('Replenishment anchor diverged');
  if (copyFix) {
    if (original.split(sectionStart).length !== 2) throw new Error('Guided section anchor diverged');
    const oldSection = original.slice(original.indexOf(sectionStart), original.indexOf(sectionEnd));
    const oldWasteLine = original.split(/\r?\n/u)
      .find(line => line.startsWith('En una merma de proceso, `id_item`'));
    const newWasteLine = local.split(/\r?\n/u)
      .find(line => line.startsWith('En una merma de proceso, `id_item`'));
    if (!oldWasteLine || !newWasteLine || oldWasteLine === newWasteLine
      || original.split(oldWasteLine).length !== 2) throw new Error('Waste copy anchor diverged');
    return original.replace(oldSection, guidedSection.replace(/\r?\n/gu, newline))
      .replace(oldWasteLine, newWasteLine);
  }
  if (original.includes(sectionStart) || original.includes(opHint)) {
    throw new Error('The prompt already contains part of the guided change');
  }
  const idAnchor = original.split(/\r?\n/u).find(line => line.startsWith('- En texto y audio, `PEDID1`'));
  if (!idAnchor || original.split(idAnchor).length !== 2) throw new Error('OP ID hint anchor diverged');
  return original
    .replace(idAnchor, `${opHint}${newline}${idAnchor}`)
    .replace(sectionEnd, guidedSection.replace(/\r?\n/gu, newline) + sectionEnd);
}

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
    headers: { 'x-api-builderbot': key },
  });
  if (!response.ok) throw new Error(`BuilderBot Manager HTTP ${response.status}`);
  return (await response.json()).flows || [];
}

function instructionsFrom(flows, saved) {
  const flow = flows.find(item => (item.id || item.uuid) === saved.flowId && item.name === saved.name);
  const answer = flow?.answers?.find(item => (item.id || item.uuid) === saved.answerId);
  const instructions = answer?.plugins?.openai?.assistantInstructions;
  if (typeof instructions !== 'string') throw new Error(`Target prompt ${saved.name} changed shape`);
  return instructions;
}

const beforeFlows = await loadFlows();
const changes = checkpoint.prompts.map(saved => {
  const before = instructionsFrom(beforeFlows, saved);
  const patched = patchedPrompt(saved.instructions);
  if (before !== saved.instructions && before !== patched) {
    throw new Error(`Prompt ${saved.name} changed since checkpoint; refusing to overwrite it`);
  }
  return { saved, before, after: restore ? saved.instructions : patched };
});

if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: restore ? 'restore-dry-run' : 'dry-run', copyFix,
    projectId, prompts: changes.map(({ saved, before, after }) => ({
      name: saved.name, beforeSha256: sha256(before), afterSha256: sha256(after),
      changed: before !== after,
    })) })}\n`);
  process.exit(0);
}

async function mcpSession(operation) {
  const abort = new AbortController();
  const pending = new Map();
  let resolveEndpoint;
  const endpointPromise = new Promise(resolvePromise => { resolveEndpoint = resolvePromise; });
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
    const result = wait ? new Promise(resolvePromise => pending.set(message.id, resolvePromise)) : null;
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'x-builderbot-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`BuilderBot MCP POST HTTP ${response.status}`);
    return result;
  }
  try {
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'wms-guided-replenishment-sync', version: '1.0.0' },
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
  for (const change of changes) {
    if (change.before === change.after) continue;
    await call('builderbot_update_answer', { projectId,
      flowId: change.saved.flowId, answerId: change.saved.answerId,
      assistant: { instructions: change.after },
    }, id++);
  }
  await call('builderbot_validate_bot', { projectId }, id++);
  if (reboot) await call('builderbot_deploy', { projectId, action: 'reboot' }, id++);
});
await new Promise(resolveDelay => setTimeout(resolveDelay, reboot ? 5000 : 1500));
const afterFlows = await loadFlows();
for (const change of changes) {
  if (instructionsFrom(afterFlows, change.saved) !== change.after) {
    throw new Error(`Readback mismatch for ${change.saved.name}`);
  }
}
process.stdout.write(`${JSON.stringify({ mode: restore ? 'restored' : 'applied', copyFix,
  rebootRequested: reboot, prompts: changes.map(({ saved, after }) => ({
    name: saved.name, sha256: sha256(after),
  })) })}\n`);
