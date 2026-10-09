import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectId = process.argv.find(arg => arg.startsWith('--project='))?.slice(10);
if (!projectId || !/^[a-f0-9-]{36}$/u.test(projectId)) throw new Error('Pass --project=<UUID>');
const source = await readFile(resolve('.env'), 'utf8').catch(error =>
  error.code === 'ENOENT' ? '' : Promise.reject(error));
const key = process.env.BUILDERBOT_MANAGER_API_KEY || process.env.BUILDERBOT_UO_STAGING_API_KEY
  || source.match(/^\s*(?:BUILDERBOT_MANAGER_API_KEY|BUILDERBOT_UO_STAGING_API_KEY)\s*=\s*(.+?)\s*$/m)?.[1]
    ?.replace(/^['"]|['"]$/gu, '');
if (!key) throw new Error('Builderbot Manager API key is unavailable');
const response = await fetch(`https://app.builderbot.cloud/api/v1/manager/flows/${projectId}`, {
  headers: { 'x-api-builderbot': key },
});
if (!response.ok) throw new Error(`Builderbot Manager HTTP ${response.status}`);
const flows = (await response.json()).flows || [];
const matches = [];
let promptCount = 0;
const prompts = [];
for (const flow of flows) {
  for (const answer of flow.answers || []) {
    const instruction = answer.plugins?.openai?.assistantInstructions;
    if (typeof instruction !== 'string' || !instruction.trim()) continue;
    promptCount++;
    prompts.push({ flow: flow.name, answerId: answer.id || answer.uuid,
      lines: instruction.split(/\r?\n/u).length });
    instruction.split(/\r?\n/u).forEach((line, index) => {
      if (/traduc|traducci|ingl[eé]s|english|idioma|language/iu.test(line)) {
        matches.push({ flow: flow.name, answerId: answer.id || answer.uuid,
          line: index + 1, text: line.trim() });
      }
    });
  }
}
process.stdout.write(`${JSON.stringify({ projectId, flowCount: flows.length, promptCount, prompts,
  matches, audio: flows.filter(flow => flow.transcribeAudio || flow.options?.transcribeAudio)
    .map(flow => ({ flow: flow.name, transcribeAudio: flow.transcribeAudio,
      options: flow.options })) }, null, 2)}\n`);
if (process.argv.includes('--assert-clean') && matches.length) process.exitCode = 1;
