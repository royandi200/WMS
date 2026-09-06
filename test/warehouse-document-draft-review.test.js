const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeWarehouseDraftReview,
  reviewWarehouseDocumentDraft,
} = require('../api/_lib/warehouse-document-draft-review');

function validReview(overrides = {}) {
  return {
    id: 17,
    motivo: 'El OCR omitio una referencia',
    fecha_documento: '2026-09-06',
    destinatario_nombre: '3Q',
    total_bultos: 4,
    items: [{
      sku: '00006-TRP', descripcion: 'Tarro cuadrado x 60', cantidad: 12,
      unidad: 'und', lote: 'LOTE-3Q-01', fecha_vencimiento: '2028-01-31',
    }],
    ...overrides,
  };
}

test('normalizes a complete correction and rejects unsafe item data', () => {
  const result = normalizeWarehouseDraftReview(validReview());
  assert.equal(result.id, 17);
  assert.equal(result.items[0].sku, '00006-TRP');
  assert.equal(result.items[0].unit, 'und');
  assert.equal(result.items[0].quantity, 12);
  assert.throws(
    () => normalizeWarehouseDraftReview(validReview({ items: [{ sku: '00006-TRP', descripcion: 'Tarro', cantidad: 0, unidad: 'und' }] })),
    /Cantidad invalida/u
  );
  assert.throws(
    () => normalizeWarehouseDraftReview(validReview({ motivo: 'x' })),
    /motivo de la correccion/u
  );
});

test('correcting a 3Q draft keeps the operation inventory-neutral and auditable', async () => {
  const statements = [];
  const conn = {
    async execute(sql, params) {
      statements.push({ sql, params });
      if (/FROM documentos_bodega_borrador/u.test(sql)) {
        return [[{
          id: 17, referencia_documento: 'REM-3Q-17', estado: 'REQUIERE_CORRECCION',
          orden_compra_id: null, maquila_envio_id: null,
        }]];
      }
      if (/FROM documento_bodega_borrador_items/u.test(sql)) {
        return [[{ sku_extraido: '00006-TRP', cantidad: 10, unidad: 'und' }]];
      }
      if (/FROM productos/u.test(sql)) {
        return [[{ id: 6, siigo_code: params[0], nombre: 'Tarro cuadrado x 60' }]];
      }
      if (/UPDATE documentos_bodega_borrador/u.test(sql)) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1, insertId: 1 }];
    },
  };

  const result = await reviewWarehouseDocumentDraft(
    conn,
    normalizeWarehouseDraftReview(validReview()),
    3
  );
  assert.equal(result.estado, 'PENDIENTE_REVISION');
  assert.equal(result.itemCount, 1);
  assert.deepEqual(result.totals, { und: 12 });
  assert.match(result.auditId, /^[a-f0-9]{16}$/u);
  const sql = statements.map((statement) => statement.sql).join('\n');
  assert.match(sql, /FOR UPDATE/u);
  assert.match(sql, /INSERT INTO system_logs/u);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE)\s+(?:stock|lots|kardex|movimientos)\b/iu);
  assert.doesNotMatch(sql, /documento_bodega_borrador_archivos/u);
});

test('a linked 3Q draft cannot be corrected', async () => {
  const conn = {
    async execute(sql) {
      if (/FROM documentos_bodega_borrador/u.test(sql)) {
        return [[{
          id: 17, referencia_documento: 'REM-3Q-17', estado: 'VINCULADO',
          orden_compra_id: 8, maquila_envio_id: 9,
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  await assert.rejects(
    reviewWarehouseDocumentDraft(conn, normalizeWarehouseDraftReview(validReview()), 3),
    /ya esta vinculado/u
  );
});

test('warehouse document route separates 3Q and purchase-order capabilities', () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/v1/warehouse-documents.js'), 'utf8');
  assert.match(source, /CAPABILITIES\.OUTSOURCING_MANAGE/u);
  assert.match(source, /CAPABILITIES\.PURCHASE_ORDER_CANCEL/u);
  assert.match(source, /if \(req\.method === 'PATCH'\)/u);
});
