import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectId = '5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d';
const apply = process.argv.includes('--apply');
const reboot = process.argv.includes('--reboot');
const restore = process.argv.includes('--restore');
const guided = process.argv.includes('--guided');
if (reboot && !apply) throw new Error('--reboot requires --apply');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const prompt = await readFile(resolve(repo, 'docs', 'Prompt WMS.txt'), 'utf8');
const env = await readFile(resolve('.env'), 'utf8');
const checkpointPath = resolve('.tmp', guided
  ? 'builderbot-pre-guided-reception-20260923.json'
  : 'builderbot-pre-single-reception-confirmation-20260923.json');
const originalTargets = JSON.parse(await readFile(
  resolve('.tmp', 'builderbot-pre-ocid-transcription-20260923.json'), 'utf8'
)).prompts;
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || env.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key || originalTargets.length !== 2) throw new Error('BuilderBot credentials or target checkpoint missing');
const hash = value => createHash('sha256').update(value).digest('hex');
const promptLines = prompt.split(/\r?\n/u);
const additions = [
  '- Solo al PREPARAR una recepción, si el audio produce',
  '- Si preguntaste por UNA sola referencia de preparación,',
].map(start => {
  const lines = promptLines.filter(line => line.startsWith(start));
  if (lines.length !== 1) throw new Error(`Expected one prompt rule: ${start}`);
  return lines[0];
});

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

function withAdditions(current) {
  const anchor = current.split(/\r?\n/u).filter(line => line.startsWith('- Las pausas de voz no definen el ID:'));
  if (anchor.length !== 1) throw new Error('The live speech-ID rule has diverged');
  const included = additions.map(line => current.includes(line));
  if (included.every(Boolean)) return current;
  if (included.some(Boolean)) throw new Error('The live confirmation rules are only partially present');
  return current.replace(anchor[0], `${anchor[0]}\n${additions.join('\n')}`);
}

function withGuidedInstructions(current) {
  const changes = [
    ['El PRIMER mensaje guiado debe contener un identificador',
      'Si el WMS acaba de responder `Recepción preparada para OC ID N`'],
    ['{"kw":"g0m@s","@ction":"AVANZAR_RECEPCION_GUIADA_OC"',
      '{"kw":"g0m@s","@ction":"AVANZAR_RECEPCION_GUIADA_OC"'],
  ];
  let updated = current;
  for (const [oldStart, newStart] of changes) {
    const desired = promptLines.filter(line => line.startsWith(newStart));
    if (desired.length !== 1) throw new Error(`Expected one local guided rule: ${newStart}`);
    if (updated.split(/\r?\n/u).includes(desired[0])) continue;
    const candidates = updated.split(/\r?\n/u).filter(line => line.startsWith(oldStart));
    if (candidates.length !== 1) throw new Error(`Live guided rule has diverged: ${oldStart}`);
    if (candidates[0] === desired[0]) continue;
    if (oldStart.startsWith('El PRIMER') && !candidates[0].includes('OCID 37')) {
      throw new Error('Live first-message rule has diverged');
    }
    if (oldStart.startsWith('{"kw"') && !candidates[0].includes('"body":"Empecemos con las tapas de OC ID 37"')) {
      throw new Error('Live guided example has diverged');
    }
    updated = updated.replace(candidates[0], desired[0]);
  }
  return updated;
}

const transform = guided ? withGuidedInstructions : withAdditions;

const beforeFlows = await loadFlows();
const savedCheckpoint = restore
  ? JSON.parse(await readFile(checkpointPath, 'utf8'))
  : null;
const updates = originalTargets.map(saved => {
  const current = target(beforeFlows, saved);
  const prior = savedCheckpoint?.prompts.find(item => item.flowId === saved.flowId
    && item.answerId === saved.answerId);
  if (restore && !prior) throw new Error(`No restoration checkpoint for ${saved.name}`);
  const desired = restore ? prior.instructions : transform(current);
  if (restore && current !== desired && current !== transform(desired)) {
    throw new Error(`Prompt ${saved.name} changed since checkpoint; refusing to restore`);
  }
  return { saved, current, desired };
});

if (!apply) {
  process.stdout.write(`${JSON.stringify({ mode: restore ? 'restore-dry-run' : 'dry-run',
    prompts: updates.map(({ saved, current, desired }) => ({ name: saved.name,
      beforeSha256: hash(current), afterSha256: hash(desired), changed: current !== desired })) })}\n`);
  process.exit(0);
}

if (!restore) {
  await writeFile(checkpointPath, JSON.stringify({ projectId, capturedAt: new Date().toISOString(),
    prompts: updates.map(({ saved, current }) => ({ name: saved.name,
      flowId: saved.flowId, answerId: saved.answerId, instructions: current })) }, null, 2),
  { flag: 'wx' });
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
      clientInfo: { name: 'wms-single-reception-confirmation', version: '1.0.0' },
    } });
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, false);
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
process.stdout.write(`${JSON.stringify({ mode: restore ? 'restored' : 'applied', rebootRequested: reboot,
  prompts: updates.map(({ saved, desired }) => ({ name: saved.name, sha256: hash(desired) })) })}\n`);
