import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const projectId = '7fdf8f81-e227-4a04-8943-5402d3be4b15';
const sectionStart = '### 4C. AVANZAR_RECEPCION_GUIADA_OC | media';
const sectionEnd = '### 5. CONFIRMAR_RECEPCION_OC | alta';
const apply = process.argv.includes('--apply');
const reboot = process.argv.includes('--reboot');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const key = process.env.BUILDERBOT_UO_STAGING_API_KEY || process.env.BUILDERBOT_MANAGER_API_KEY;
if (!key) throw new Error('BuilderBot Manager key unavailable');
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const local = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const localStart = local.indexOf(sectionStart);
const localEnd = local.indexOf(sectionEnd, localStart);
if (localStart < 0 || localEnd < 0) throw new Error('Local guided reception section missing');
const replacement = local.slice(localStart, localEnd);

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
    headers: { 'x-api-builderbot': key }, signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`BuilderBot Manager HTTP ${response.status}`);
  return (await response.json()).flows || [];
}

function targets(flows) {
  return ['Entrada', 'Voz'].map(name => {
    const candidates = flows.filter(flow => flow.name === name);
    if (candidates.length !== 1) throw new Error(`Expected one ${name} flow`);
    const flow = candidates[0];
    const answers = (flow.answers || []).filter(answer =>
      typeof answer.plugins?.openai?.assistantInstructions === 'string');
    if (answers.length !== 1) throw new Error(`Expected one ${name} assistant`);
    const answer = answers[0];
    const before = answer.plugins.openai.assistantInstructions;
    const start = before.indexOf(sectionStart);
    const end = before.indexOf(sectionEnd, start);
    if (start < 0 || end < 0 || before.indexOf(sectionStart, start + 1) >= 0) {
      throw new Error(`Unexpected ${name} prompt structure`);
    }
    return { name, flowId: flow.id || flow.uuid, answerId: answer.id || answer.uuid,
      before, after: before.slice(0, start) + replacement + before.slice(end) };
  });
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
      buffer += decoder.decode(value, { stream: true }).replace(/\r/gu, '');
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
      clientInfo: { name: 'wms-backup-guided-reception-sync', version: '1.0.0' },
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

const changes = targets(await loadFlows());
console.log(JSON.stringify({ projectId, mode: apply ? 'apply' : 'dry-run',
  changes: changes.map(change => ({ name: change.name,
    before: hash(change.before), after: hash(change.after),
    changed: change.before !== change.after })) }));
if (apply && changes.some(change => change.before !== change.after)) {
  await mcpSession(async call => {
    let id = 2;
    const applied = [];
    try {
      for (const change of changes) {
        if (change.before === change.after) continue;
        await call('builderbot_update_answer', { projectId,
          flowId: change.flowId, answerId: change.answerId,
          assistant: { instructions: change.after } }, id++);
        applied.push(change);
      }
      await call('builderbot_validate_bot', { projectId }, id++);
      if (reboot) await call('builderbot_deploy', { projectId, action: 'reboot' }, id++);
    } catch (error) {
      for (const change of applied.reverse()) {
        await call('builderbot_update_answer', { projectId,
          flowId: change.flowId, answerId: change.answerId,
          assistant: { instructions: change.before } }, id++).catch(() => {});
      }
      throw error;
    }
  });
  const after = targets(await loadFlows());
  if (after.some((change, index) => change.before !== changes[index].after)) {
    throw new Error('Prompt readback mismatch');
  }
  console.log(JSON.stringify({ projectId, updated: true, rebootRequested: reboot }));
}
