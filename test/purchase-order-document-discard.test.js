const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  discardPurchaseOrderDocumentDraft,
  normalizePurchaseOrderDocumentDiscard,
} = require('../api/_lib/purchase-order-document-discard');
const { CAPABILITIES, hasCapability } = require('../api/_lib/capabilities');

function connectionWith(responses) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (!responses.length) throw new Error('Consulta inesperada');
      return responses.shift();
    },
  };
}

function draft(overrides = {}) {
  return {
    id: 15,
    referencia_documento: 'OC-QA-BORRADOR-15',
    estado: 'REQUIERE_CORRECCION',
    orden_compra_id: null,
    maquila_envio_id: null,
    ...overrides,
  };
}

test('purchase order draft discard input is normalized and bounded', () => {
  assert.deepEqual(
    normalizePurchaseOrderDocumentDiscard({ document_draft_id: '15', motivo: '  Lectura   incorrecta  ' }),
    { id: 15, reason: 'Lectura incorrecta' }
  );
  assert.throws(() => normalizePurchaseOrderDocumentDiscard({ id: 0, motivo: 'Duplicado' }), /invalido/u);
  assert.throws(() => normalizePurchaseOrderDocumentDiscard({ id: 15, motivo: 'no' }), /obligatorio/u);
  assert.throws(() => normalizePurchaseOrderDocumentDiscard({ id: 15, motivo: 'x'.repeat(301) }), /300/u);
});

test('discarding purchase order drafts is restricted to privileged roles', () => {
  assert.equal(hasCapability('admin', CAPABILITIES.PURCHASE_ORDER_CANCEL), true);
  assert.equal(hasCapability('recepcion_cierre', CAPABILITIES.PURCHASE_ORDER_CANCEL), false);
  assert.equal(hasCapability('alistador', CAPABILITIES.PURCHASE_ORDER_CANCEL), false);
  assert.equal(hasCapability('despacho', CAPABILITIES.PURCHASE_ORDER_CANCEL), false);
});

test('pending purchase order draft is soft-discarded and audited', async () => {
  const conn = connectionWith([
    [[draft()], []],
    [{ affectedRows: 1 }, []],
    [{ insertId: 121 }, []],
  ]);
  const result = await discardPurchaseOrderDocumentDraft(conn, {
    id: 15,
    reason: 'Lectura incorrecta',
    userId: 7,
  });
  assert.equal(result.estado, 'DESCARTADO');
  assert.equal(result.duplicate, false);
  assert.match(conn.calls[1].sql, /SET estado = 'DESCARTADO'/u);
  assert.match(conn.calls[1].sql, /orden_compra_id IS NULL/u);
  assert.match(conn.calls[1].sql, /maquila_envio_id IS NULL/u);
  assert.deepEqual(conn.calls[1].params, [7, 15]);
  assert.match(conn.calls[2].sql, /INSERT INTO system_logs/u);
  assert.doesNotMatch(conn.calls[2].params[2], /contenido|documento_pdf|sha256/u);
});

test('discard retry is idempotent and preserves the first audit event', async () => {
  const conn = connectionWith([[[draft({ estado: 'DESCARTADO' })], []]]);
  const result = await discardPurchaseOrderDocumentDraft(conn, {
    id: 15,
    reason: 'Otro motivo',
    userId: 8,
  });
  assert.equal(result.duplicate, true);
  assert.equal(conn.calls.length, 1);
});

test('linked purchase order draft cannot be discarded', async () => {
  const conn = connectionWith([[[draft({ estado: 'VINCULADO', orden_compra_id: 44 })], []]]);
  await assert.rejects(
    discardPurchaseOrderDocumentDraft(conn, { id: 15, reason: 'Documento duplicado', userId: 7 }),
    /ya esta vinculado/u
  );
  assert.equal(conn.calls.length, 1);
});

test('warehouse document route exposes authorized transactional discard', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'v1', 'warehouse-documents.js'), 'utf8');
  assert.match(source, /requireCapability\(req, CAPABILITIES\.PURCHASE_ORDER_CANCEL\)/u);
  assert.match(source, /req\.method === 'DELETE'/u);
  assert.match(source, /GET,POST,DELETE/u);
  assert.match(source, /beginTransaction\(\)/u);
  assert.match(source, /rollback\(\)/u);
});

test('draft discard is a soft delete and never mutates inventory', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'purchase-order-document-discard.js'), 'utf8');
  assert.doesNotMatch(source, /DELETE\s+FROM/u);
  assert.doesNotMatch(source, /(?:INSERT|UPDATE)\s+(?:INTO\s+)?(?:stock|lots|movimientos|kardex)\b/iu);
  assert.match(source, /revisado_por = \?/u);
  assert.match(source, /revisado_en = NOW\(\)/u);
});

test('dashboard exposes an admin-only confirmed discard action', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'pages', 'RecepcionPage.jsx'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'api', 'purchaseOrders.api.js'), 'utf8');
  assert.match(page, /canDiscardDraft=\{allowed\('purchase_order\.cancel'\)\}/u);
  assert.match(page, /Confirmo que este borrador no debe convertirse en una orden de compra/u);
  assert.match(page, /El PDF y el registro se conservaran para auditoria/u);
  assert.match(api, /\.delete\('\/warehouse-documents'/u);
});
