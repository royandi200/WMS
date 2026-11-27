const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

test('WMS classifier prompt preserves source text without language-priming examples', () => {
  const prompt = readFileSync(resolve(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  assert.doesNotMatch(prompt, /traduc|traducci|ingl[eé]s|english|idioma|language/iu);
  assert.match(prompt, /Conserva `MENSAJE_REAL` literalmente en `body`, `text` y `query`/u);
  assert.match(prompt, /Si `\{aiVoice\}` contiene texto, cópialo exactamente/u);
  assert.match(prompt, /Nunca conviertas un «sí» aislado en autorización para crear la OP/u);
});

test('WMS classifier prompt separates picking suggestions from confirmation', () => {
  const prompt = readFileSync(resolve(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  assert.match(prompt, /\bintencion_alistamiento\b/u);
  assert.match(prompt, /«¿De dónde puedo sacar otros liners\?»[^\n]*"tipo":"OTRA_UBICACION","producto":"liners"/u);
  assert.match(prompt, /La búsqueda no selecciona ni confirma nada/u);
  assert.match(prompt, /"tipo":"VER_RESUMEN"/u);
  assert.match(prompt, /"tipo":"ACLARAR_MATERIAL"/u);
});
