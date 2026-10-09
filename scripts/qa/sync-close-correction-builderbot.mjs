import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apply = process.argv.includes('--apply');
const reboot = process.argv.includes('--reboot');
const stock = process.argv.includes('--stock');
const language = process.argv.includes('--language');
const naturalMaterial = process.argv.includes('--natural-material');
if ([stock, language, naturalMaterial].filter(Boolean).length > 1) throw new Error('Choose only one sync scope');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const beforePath = resolve('.tmp', naturalMaterial ? 'builderbot-pre-natural-material-close-20261008.json'
  : language ? 'builderbot-pre-language-audit-20261008.json'
  : stock ? 'builderbot-pre-stock-confirm-20261008.json'
    : 'builderbot-pre-close-fallback-20261008.json');
const afterPath = resolve('.tmp', naturalMaterial ? 'builderbot-post-natural-material-close-20261008.json'
  : language ? 'builderbot-post-language-audit-20261008.json'
  : stock ? 'builderbot-post-stock-confirm-20261008.json'
    : 'builderbot-post-close-fallback-20261008.json');
const before = JSON.parse(await readFile(beforePath, 'utf8'));
if (before.projectId !== '7fdf8f81-e227-4a04-8943-5402d3be4b15'
  || before.prompts.map(prompt => prompt.name).join(',') !== 'Entrada,Voz') {
  throw new Error('Unexpected Builderbot project or prompt checkpoint');
}
const local = await readFile(new URL('../../docs/Prompt WMS.txt', import.meta.url), 'utf8');
const env = await readFile(resolve('.env'), 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
const key = process.env.BUILDERBOT_MANAGER_API_KEY || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('Builderbot Manager API key is unavailable');
const hash = value => createHash('sha256').update(value).digest('hex');
const unix = value => value.replace(/\r\n/gu, '\n');

function selectedSection(source) {
  const startHeading = stock || language ? '### 5. LIBERAR_ORDEN_PRODUCCION' : '### 10.';
  const endHeading = stock || language ? '### 6. CONFIRMAR_MATERIALES_PRODUCCION' : '### 11.';
  const start = source.indexOf(startHeading);
  const end = source.indexOf(endHeading, start + startHeading.length);
  if (start < 0 || end < 0 || source.indexOf(startHeading, start + 1) >= 0) {
    throw new Error(`Cannot isolate ${startHeading} of the prompt`);
  }
  return source.slice(start, end);
}

function languageRule(source, label = '5B.') {
  const line = source.split(/\r?\n/u).find(value => value.startsWith(`${label} `));
  if (!line) throw new Error(`Cannot isolate language rule ${label}`);
  return line;
}

const originalSection = selectedSection(before.prompts[0].instructions);
const desiredSection = selectedSection(local);
if (unix(selectedSection(before.prompts[1].instructions)) !== unix(originalSection)) {
  throw new Error('Entrada and Voz selected sections differ in checkpoint');
}
if (stock && (languageRule(before.prompts[0].instructions) !== languageRule(before.prompts[1].instructions)
  || !desiredSection.includes('Confirm create op for security stock'))) {
  throw new Error('Stock confirmation checkpoint or replacement is inconsistent');
}
if (language && (['5A.', '5B.', '5C.'].some(label =>
  languageRule(before.prompts[0].instructions, label)
    !== languageRule(before.prompts[1].instructions, label))
  || /traduc|traducci|ingl[eé]s|english|idioma|language/iu.test(local))) {
  throw new Error('Language checkpoint differs or local prompt retains language priming');
}
if (naturalMaterial && !desiredSection.includes('Una corrección del insumo también puede ser declarativa:')) {
  throw new Error('Natural material correction rule missing from local prompt');
}
if (!stock && !language && !naturalMaterial && unix(desiredSection).split('params.correccion_pt').length !== 2) {
  throw new Error('Expected exactly one new correction instruction');
}

async function loadFlows() {
  const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${before.projectId}`, {
    headers: { 'x-api-builderbot': key },
  });
  if (!response.ok) throw new Error(`Builderbot Manager HTTP ${response.status}`);
  return (await response.json()).flows || [];
}

function instructions(flows, saved) {
  const flow = flows.find(item => (item.id || item.uuid) === saved.flowId && item.name === saved.name);
  const answer = flow?.answers?.find(item => (item.id || item.uuid) === saved.answerId);
  const prompt = answer?.plugins?.openai?.assistantInstructions;
  if (typeof prompt !== 'string') throw new Error(`Prompt ${saved.name} changed shape`);
  return prompt;
}

const live = await loadFlows();
const changes = before.prompts.map(saved => {
  if (hash(saved.instructions) !== saved.sha256) throw new Error(`Checkpoint hash mismatch: ${saved.name}`);
  const current = instructions(live, saved);
  if (current !== saved.instructions) throw new Error(`Live ${saved.name} changed since checkpoint; no overwrite`);
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  let updated = current.replace(selectedSection(current), unix(desiredSection).replace(/\n/gu, newline));
  if (stock) updated = updated.replace(languageRule(current), languageRule(local));
  if (language) {
    for (const label of ['5A.', '5B.', '5C.']) {
      updated = updated.replace(languageRule(current, label), languageRule(local, label));
    }
    if (/traduc|traducci|ingl[eé]s|english|idioma|language/iu.test(updated)) {
      throw new Error(`Updated ${saved.name} still contains language priming`);
    }
  }
  return { saved, current, updated };
});
if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', projectId: before.projectId,
    prompts: changes.map(({ saved, current, updated }) => ({ name: saved.name,
      beforeSha256: hash(current), afterSha256: hash(updated), changed: current !== updated })) })}\n`);
  process.exit(0);
}
await writeFile(afterPath, JSON.stringify({ projectId: before.projectId,
  capturedAt: new Date().toISOString(), prompts: changes.map(({ saved, updated }) => ({
    name: saved.name, flowId: saved.flowId, answerId: saved.answerId,
    instructions: updated, sha256: hash(updated),
  })) }, null, 2), { flag: 'wx' });

async function mcpSession(operation) {
  const abort = new AbortController();
  const pending = new Map();
  let resolveEndpoint;
  const endpointPromise = new Promise(resolvePromise => { resolveEndpoint = resolvePromise; });
  const stream = await fetch('https://bbc-mcp-http.builderbot.cloud/mcp/builderbot/sse', {
    headers: { 'x-builderbot-api-key': key, accept: 'text/event-stream' }, signal: abort.signal,
  });
  if (!stream.ok || !stream.body) throw new Error(`Builderbot MCP SSE HTTP ${stream.status}`);
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
    if (!response.ok) throw new Error(`Builderbot MCP POST HTTP ${response.status}`);
    return result;
  }
  try {
    await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'wms-close-correction-sync', version: '1.0.0' },
    } });
    await send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, false);
    return await operation(async (name, args, id) => {
      const result = await send({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name, arguments: args } });
      if (result?.error || result?.result?.isError) {
        throw new Error(`Builderbot ${name} failed: ${JSON.stringify(result.error || result.result)}`);
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
    if (change.current === change.updated) continue;
    await call('builderbot_update_answer', { projectId: before.projectId,
      flowId: change.saved.flowId, answerId: change.saved.answerId,
      assistant: { instructions: change.updated },
    }, id++);
  }
  await call('builderbot_validate_bot', { projectId: before.projectId }, id++);
  if (reboot) await call('builderbot_deploy', { projectId: before.projectId, action: 'reboot' }, id++);
});
const readback = await loadFlows();
for (const change of changes) {
  if (instructions(readback, change.saved) !== change.updated) {
    throw new Error(`Readback mismatch for ${change.saved.name}`);
  }
}
process.stdout.write(`${JSON.stringify({ mode: 'applied', rebootRequested: reboot,
  prompts: changes.map(({ saved, updated }) => ({ name: saved.name, sha256: hash(updated) })) })}\n`);
