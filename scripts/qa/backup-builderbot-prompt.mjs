import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectId = '5fe41915-a5e6-423c-9bd4-b4e63dbe0d3d';
const targets = [
  ['Entrada', 'fa49edb8-5ecb-414c-b4d6-aa005ed19343', 'b4e6d905-70c6-4a30-a519-e3eb7e0adcce'],
  ['Voz', '79ce1f41-00f7-45ba-a3f3-8f042aebe0a4', 'bca07485-2ad1-449c-aa38-3b851b57f79c'],
];

const source = await readFile(resolve('.env'), 'utf8');
const key = process.env.BUILDERBOT_MANAGER_API_KEY
  || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || source.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '');
if (!key) throw new Error('BuilderBot Manager API key is unavailable');

const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
  headers: { 'x-api-builderbot': key },
});
if (!response.ok) throw new Error(`BuilderBot Manager HTTP ${response.status}`);
const flows = (await response.json()).flows || [];
const prompts = targets.map(([name, flowId, answerId]) => {
  const flow = flows.find(item => (item.id || item.uuid) === flowId && item.name === name);
  const answer = flow?.answers?.find(item => (item.id || item.uuid) === answerId);
  const instructions = answer?.plugins?.openai?.assistantInstructions;
  if (typeof instructions !== 'string' || !instructions.length) {
    throw new Error(`Prompt not found for ${name}; no backup was written`);
  }
  return {
    name, flowId, answerId, instructions,
    sha256: createHash('sha256').update(instructions).digest('hex'),
  };
});
const path = resolve('.tmp', 'builderbot-pre-guided-reception-20260923.json');
await writeFile(path, JSON.stringify({ projectId, capturedAt: new Date().toISOString(), prompts }, null, 2), {
  flag: 'wx',
});
process.stdout.write(`${JSON.stringify({ path, prompts: prompts.map(({ name, sha256 }) => ({ name, sha256 })) })}\n`);
