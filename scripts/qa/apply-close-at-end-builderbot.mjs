import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const backup = JSON.parse(await readFile(resolve('.tmp', 'builderbot-pre-close-20260924.json'), 'utf8'));
const afterPath = resolve('.tmp', 'builderbot-post-close-20260924.json');
const local = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const baseline = execFileSync('git', ['show', '1c142db:docs/Prompt WMS.txt'], {
  cwd: repoRoot, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
});
const env = await readFile(resolve('.env'), 'utf8');
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key || backup.prompts.length !== 2) throw new Error('Missing key or backup');
const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');
const reboot = process.argv.includes('--reboot');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const hash = value => createHash('sha256').update(value).digest('hex');
const unix = value => value.replace(/\r\n/gu, '\n');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || source.indexOf(start, from + 1) >= 0) {
    throw new Error(`Cannot isolate prompt section ${start}`);
  }
  return source.slice(from, to);
}

function patch(original) {
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let next = original;
  const oldLine = 'Para reemplazar unidades no conformes y completar el objetivo de una OP, no uses este handler de bajo nivel. Usa el flujo seguro de reposicion descrito a continuacion.';
  const newLine = '`ENTREGA_ADICIONAL` está retirada: el material repuesto se declara al cierre de la OP con SKU o alias, cantidad, lote y causa. Esta acción solo conserva `DEVOLUCION` para movimientos anteriores legítimos.';
  if (!next.includes(oldLine) && !next.includes(newLine)) throw new Error('7F diverged');
  if (next.includes(oldLine)) next = next.replace(oldLine, newLine);
  const ranges = [
    ['### 7G', '### 7B.'], ['### 7B.', '### 7C.'],
    ['### 9.', '### 10.'], ['### 10.', '### 11.'],
  ];
  for (const [start, end] of ranges) {
    const prior = section(baseline, start, end);
    const desired = section(local, start, end);
    const current = section(next, start, end);
    if (unix(current) === unix(desired)) continue;
    const knownPrior = start === '### 7G'
      ? unix(prior)
        .replace(' Para uno o varios SKU específicos, usa `GUIAR_REPOSICION_PRODUCCION` en lugar de esta acción directa.', '')
        .replace(/Si se perdió una unidad terminada completa, no se recuperó ningún componente y el administrador autoriza reponer todo el BOM, usa esta acción para la unidad faltante\.[^\n]+\n\n/u, '')
      : start === '### 7B.'
        ? unix(prior).replace(/Si el alistador dice `ya alisté la reposición de OP ID N`[^\n]+\n\n/u, '')
      : unix(prior);
    if (unix(current) !== unix(prior) && unix(current) !== knownPrior) {
      const actual = unix(current);
      const expected = unix(prior);
      let position = 0;
      while (position < Math.min(actual.length, expected.length)
        && actual[position] === expected[position]) position += 1;
      throw new Error(`Live prompt diverged in ${start} at ${position}; baseline ${hash(expected)}, live ${hash(actual)}`);
    }
    next = next.replace(current, unix(desired).replace(/\n/gu, newline));
  }
  return next;
}

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${backup.projectId}`, {
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

const applied = restore ? JSON.parse(await readFile(afterPath, 'utf8')) : null;
const live = await loadFlows();
const changes = backup.prompts.map(saved => {
  const expected = restore ? applied.prompts.find(item => item.name === saved.name)?.instructions
    : saved.instructions;
  const current = instructions(live, saved);
  if (current !== expected) throw new Error(`Live ${saved.name} differs from saved checkpoint; no overwrite`);
  return { saved, before: current, after: restore ? saved.instructions : patch(current) };
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
      buffer += decoder.decode(value, { stream: true }).replace(/\r/gu, '');
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
      clientInfo: { name: 'wms-close-at-end-sync', version: '1.0.0' },
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
    await call('builderbot_update_answer', { projectId: backup.projectId,
      flowId: change.saved.flowId, answerId: change.saved.answerId,
      assistant: { instructions: change.after },
    }, id++);
  }
  await call('builderbot_validate_bot', { projectId: backup.projectId }, id++);
  if (reboot) await call('builderbot_deploy', { projectId: backup.projectId, action: 'reboot' }, id++);
});
await new Promise(resolveDelay => setTimeout(resolveDelay, reboot ? 5000 : 1500));
const readback = await loadFlows();
for (const change of changes) {
  if (instructions(readback, change.saved) !== change.after) {
    throw new Error(`Readback mismatch for ${change.saved.name}`);
  }
}
if (!restore) {
  await writeFile(afterPath, JSON.stringify({ projectId: backup.projectId,
    capturedAt: new Date().toISOString(), prompts: changes.map(({ saved, after }) => ({
      name: saved.name, flowId: saved.flowId, answerId: saved.answerId, instructions: after,
      sha256: hash(after),
    })) }, null, 2), { flag: 'wx' });
}
process.stdout.write(`${JSON.stringify({ mode: restore ? 'restored' : 'applied',
  rebootRequested: reboot, prompts: changes.map(({ saved, after }) => ({ name: saved.name,
    sha256: hash(after) })) })}\n`);
