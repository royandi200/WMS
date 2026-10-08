const test = require('node:test');
const assert = require('node:assert/strict');
const { groundedCloseCorrection } = require('../api/_lib/production-close-correction');

test('el respaldo interpreta solo datos del PT respaldados por el mensaje actual', () => {
  const text = 'La producción buena, cinco unidades; las buenas, destino C1';
  assert.deepEqual(groundedCloseCorrection(text, { correccion_pt: [
    { campo: 'conformes', valor: 5, evidencia: 'producción buena, cinco unidades' },
    { campo: 'ubicacion', valor: 'C1', evidencia: 'las buenas, destino C1' },
  ] }), { conformes: 5, ubicacion: 'C1' });
});

test('el respaldo no acepta valores del historial, números ambiguos ni insumos', () => {
  assert.deepEqual(groundedCloseCorrection('las buenas, destino C1', { correccion_pt: [
    { campo: 'ubicacion', valor: 'C2', evidencia: 'las buenas, destino C2' },
  ] }), {});
  assert.deepEqual(groundedCloseCorrection('las buenas, de C2 a C1', { correccion_pt: [
    { campo: 'ubicacion', valor: 'C1', evidencia: 'las buenas, de C2 a C1' },
  ] }), {});
  assert.deepEqual(groundedCloseCorrection('partida de tapas, destino A8', { correccion_pt: [
    { campo: 'ubicacion', valor: 'A8', evidencia: 'partida de tapas, destino A8' },
  ] }), {});
  assert.deepEqual(groundedCloseCorrection('producto no conforme, cinco unidades', { correccion_pt: [
    { campo: 'conformes', valor: 5, evidencia: 'producto no conforme, cinco unidades' },
  ] }), {});
  assert.deepEqual(groundedCloseCorrection('las buenas fueron 5 de la OP 116', { correccion_pt: [
    { campo: 'conformes', valor: 5, evidencia: 'las buenas fueron 5 de la OP 116' },
  ] }), {});
  assert.deepEqual(groundedCloseCorrection('no las buenas, destino C1', { correccion_pt: [
    { campo: 'ubicacion', valor: 'C1', evidencia: 'las buenas, destino C1' },
  ] }), {});
});

test('sugerencias contradictorias para el mismo dato se descartan', () => {
  assert.deepEqual(groundedCloseCorrection('las buenas: 4, luego las buenas: 5', { correccion_pt: [
    { campo: 'conformes', valor: 4, evidencia: 'las buenas: 4' },
    { campo: 'conformes', valor: 5, evidencia: 'las buenas: 5' },
  ] }), {});
});

test('el respaldo puede desactivarse sin alterar el parser existente', () => {
  const previous = process.env.PRODUCTION_CLOSE_LLM_CORRECTION_ENABLED;
  try {
    process.env.PRODUCTION_CLOSE_LLM_CORRECTION_ENABLED = 'false';
    assert.deepEqual(groundedCloseCorrection('las buenas, destino C1', { correccion_pt: [
      { campo: 'ubicacion', valor: 'C1', evidencia: 'las buenas, destino C1' },
    ] }), {});
  } finally {
    if (previous === undefined) delete process.env.PRODUCTION_CLOSE_LLM_CORRECTION_ENABLED;
    else process.env.PRODUCTION_CLOSE_LLM_CORRECTION_ENABLED = previous;
  }
});
