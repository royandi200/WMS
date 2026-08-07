#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildWmsStatusEvent,
  canonicalJson,
  resolveGitHead,
} = require('./wms-status-event');

function parseArgs(argv) {
  const result = { input: 'config/buzz-status.json', output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requiere una ruta`);
      result[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`argumento no permitido: ${argument}`);
    }
  }
  return result;
}

function resolveInsideRepo(repoRoot, requestedPath, field) {
  const resolved = path.resolve(repoRoot, requestedPath);
  const relative = path.relative(repoRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${field} debe permanecer dentro del repositorio WMS`);
  }
  return resolved;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolveInsideRepo(repoRoot, args.input, '--input');
  const manifest = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const event = buildWmsStatusEvent(manifest, resolveGitHead(repoRoot));
  const output = `${canonicalJson(event)}\n`;

  if (args.output) {
    const outputPath = resolveInsideRepo(repoRoot, args.output, '--output');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${outputPath}\n`);
    return;
  }
  process.stdout.write(output);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
