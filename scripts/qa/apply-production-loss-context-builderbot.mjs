import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const checkpoint = JSON.parse(await readFile(resolve('.tmp',
  'builderbot-pre-production-loss-context-20260924.json'), 'utf8'));
const local = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const env = await readFile(resolve('.env'), 'utf8');
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');
const reboot = process.argv.includes('--reboot');
if (!key || checkpoint.prompts.length !== 2) throw new Error('Missing key or checkpoint');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const hash = value => createHash('sha256').update(value).digest('hex');
const line = (source, prefix) => {
  const matches = source.split(/\r?\n/u).filter(row => row.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Expected exactly one line: ${prefix}`);
  return matches[0];
};

function patch(original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const additions = [
    ['Si el usuario quiere reponer uno o varios materiales de una OP,',
      'Si el administrador responde a un aviso reciente de merma de una sola OP,'],
    ['En una merma de proceso, `id_item`',
      'Al registrar una merma de material en una OP,'],
    ['Cuando el usuario indique una OP y use un nombre corto como',
      'Si el operario responde al aviso de inicio de una sola OP reciente,'],
  ];
  let output = original;
  for (const [anchorPrefix, addedPrefix] of additions) {
    const anchor = line(output, anchorPrefix);
    const added = line(local, addedPrefix);
    if (output.includes(added) || output.split(anchor).length !== 2) {
      throw new Error(`Live prompt diverged near ${anchorPrefix}`);
    }
    output = output.replace(anchor, `${anchor}${newline}${newline}${added}`);
  }
  const oldReason = line(output, '`merma`, `pérdida` o `desperdicio`');
  const newReason = line(local, '`merma`, `pérdida` o `desperdicio`');
  if (oldReason === newReason || output.split(oldReason).length !== 2) {
    throw new Error('Waste-reason paragraph already changed or diverged');
  }
  return output.replace(oldReason, newReason);
}

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${checkpoint.projectId}`, {
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
  const after = restore ? saved.instructions : patch(saved.instructions);
  const before = instructions(beforeFlows, saved);
  if (before !== saved.instructions && before !== patch(saved.instructions)) {
    throw new Error(`Prompt ${saved.name} changed since checkpoint; refusing overwrite`);
  }
  return { saved, before, after };
});

if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: restore ? 'restore-dry-run' : 'dry-run',
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
        const event = block.split('\n').find(row => row.startsWith('event:'))?.slice(6).trim();
        const data = block.split('\n').filter(row => row.startsWith('data:'))
          .map(row => row.slice(5).trim()).join('\n');
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
      clientInfo: { name: 'wms-production-loss-context-sync', version: '1.0.0' },
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
    await call('builderbot_update_answer', { projectId: checkpoint.projectId,
      flowId: change.saved.flowId, answerId: change.saved.answerId,
      assistant: { instructions: change.after },
    }, id++);
  }
  await call('builderbot_validate_bot', { projectId: checkpoint.projectId }, id++);
  if (reboot) await call('builderbot_deploy', { projectId: checkpoint.projectId, action: 'reboot' }, id++);
});
await new Promise(resolveDelay => setTimeout(resolveDelay, reboot ? 5000 : 1500));
const afterFlows = await loadFlows();
for (const change of changes) {
  if (instructions(afterFlows, change.saved) !== change.after) {
    throw new Error(`Readback mismatch for ${change.saved.name}`);
  }
}
process.stdout.write(`${JSON.stringify({ mode: restore ? 'restored' : 'applied',
  rebootRequested: reboot,
  prompts: changes.map(({ saved, after }) => ({ name: saved.name, sha256: hash(after) })) })}\n`);
