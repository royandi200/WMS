import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectId = '5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d';
const apply = process.argv.includes('--apply');
const reboot = process.argv.includes('--reboot');
const restore = process.argv.includes('--restore');
const closeCopy = process.argv.includes('--close-copy');
if (reboot && !apply) throw new Error('--reboot requires --apply');

const checkpoint = JSON.parse(await readFile(resolve('.tmp', closeCopy
  ? 'builderbot-pre-close-guide-copy-20260924.json'
  : 'builderbot-pre-spanish-only-20260924.json'), 'utf8'));
if (checkpoint.projectId !== projectId || checkpoint.prompts.length !== 2) {
  throw new Error('BuilderBot checkpoint does not match the project');
}
const local = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const anchor = closeCopy
  ? 'No asumas merma 0. Si falta merma, pregunta solo por la merma. Si falta ubicación, pregunta solo dónde quedará el producto terminado. Usa `{history}` para conservar el resto.'
  : '5. No resumas, traduzcas, corrijas ni reemplaces `MENSAJE_REAL` con texto del historial.';
const rule = local.split(/\r?\n/u).find(line => line.startsWith(closeCopy
  ? 'No asumas merma 0. Desde el primer mensaje de cierre'
  : '5A. Nunca traduzcas al inglés'));
if (!rule || local.split(anchor).length !== (closeCopy ? 1 : 2)) {
  throw new Error('Local target rule is missing');
}

const env = await readFile(resolve('.env'), 'utf8');
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('BuilderBot Manager API key is unavailable');
const hash = value => createHash('sha256').update(value).digest('hex');

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
    headers: { 'x-api-builderbot': key },
  });
  if (!response.ok) throw new Error(`BuilderBot Manager HTTP ${response.status}`);
  return (await response.json()).flows || [];
}

function instructions(flows, saved) {
  const flow = flows.find(item => (item.id || item.uuid) === saved.flowId && item.name === saved.name);
  const answer = flow?.answers?.find(item => (item.id || item.uuid) === saved.answerId);
  const prompt = answer?.plugins?.openai?.assistantInstructions;
  if (typeof prompt !== 'string') throw new Error(`Prompt ${saved.name} changed shape`);
  return prompt;
}

const beforeFlows = await loadFlows();
const changes = checkpoint.prompts.map(saved => {
  if (saved.instructions.split(anchor).length !== 2 || saved.instructions.includes(rule)) {
    throw new Error(`Checkpoint anchor diverged for ${saved.name}`);
  }
  const newline = saved.instructions.includes('\r\n') ? '\r\n' : '\n';
  const patched = saved.instructions.replace(anchor, closeCopy ? rule : `${anchor}${newline}${rule}`);
  const before = instructions(beforeFlows, saved);
  if (before !== saved.instructions && before !== patched) {
    throw new Error(`Live prompt ${saved.name} changed after checkpoint; refusing to overwrite`);
  }
  return { saved, before, after: restore ? saved.instructions : patched };
});

if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: restore ? 'restore-dry-run' : 'dry-run', closeCopy,
    prompts: changes.map(({ saved, before, after }) => ({ name: saved.name,
      beforeSha256: hash(before), afterSha256: hash(after), changed: before !== after })) })}\n`);
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
      clientInfo: { name: 'wms-spanish-only-sync', version: '1.0.0' },
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
  if (instructions(afterFlows, change.saved) !== change.after) {
    throw new Error(`Readback mismatch for ${change.saved.name}`);
  }
}
process.stdout.write(`${JSON.stringify({ mode: restore ? 'restored' : 'applied',
  prompts: changes.map(({ saved, after }) => ({ name: saved.name, sha256: hash(after) })) })}\n`);
