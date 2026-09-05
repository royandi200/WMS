const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  assertDocumentHasSameMessageInstruction,
  normalizeSameMessageInstruction,
} = require('../api/_lib/document-message-policy');

test('document intake requires text attached to the same WhatsApp message', () => {
  assert.equal(normalizeSameMessageInstruction('  Orden de compra  '), 'Orden de compra');
  assert.equal(normalizeSameMessageInstruction(''), '');
  assert.equal(normalizeSameMessageInstruction('{body}'), '');
  assert.throws(
    () => assertDocumentHasSameMessageInstruction(
      'REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO',
      ''
    ),
    /llego sin texto adjunto/u
  );
  assert.throws(
    () => assertDocumentHasSameMessageInstruction(
      'REGISTRAR_BORRADOR_SALIDA_3Q_DOCUMENTO',
      '{body}'
    ),
    /llego sin texto adjunto/u
  );
  assert.equal(
    assertDocumentHasSameMessageInstruction(
      'REGISTRAR_BORRADOR_ORDEN_COMPRA_DOCUMENTO',
      'Procesar como orden de compra'
    ),
    'Procesar como orden de compra'
  );
});

test('document policy never recovers text from OCR and documents the provider limitation', () => {
  const webhook = fs.readFileSync(
    path.join(__dirname, '../api/v1/webhook/builderbot.js'),
    'utf8'
  );
  const prompt = fs.readFileSync(
    path.join(__dirname, '../docs/Prompt WMS Documentos BBC.txt'),
    'utf8'
  );
  assert.match(
    webhook,
    /assertDocumentHasSameMessageInstruction\(action, contractUserText\)/u
  );
  assert.doesNotMatch(
    webhook,
    /assertDocumentHasSameMessageInstruction\(action, rawText\)/u
  );
  assert.match(prompt, /Un texto enviado despues no recupera ni vincula el archivo anterior/u);
  assert.match(prompt, /no expone de forma confiable el texto adjunto/u);
  assert.match(prompt, /solo puede crear un borrador sujeto a revision humana/u);
  assert.doesNotMatch(prompt, /La API valida que exista texto adjunto/u);
});
