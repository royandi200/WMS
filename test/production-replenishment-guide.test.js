const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyAdvance, cleanAdvance, confirmedByUser, guideSummary, positiveQuantity,
} = require('../api/_lib/production-replenishment-guide');
const { capabilityForAction, CAPABILITIES } = require('../api/_lib/capabilities');
const { contextualProductMatches } = require('../api/_lib/product-references');

test('accepts multiple products from one audio or a single quantity in a later message', () => {
  assert.deepEqual(cleanAdvance({ avance: {
    items: [{ producto: 'tapas', cantidad: 2 }, { producto: 'etiqueta', cantidad: 1 }],
    motivo: 'daño de empaque',
  } }), {
    items: [{ producto: 'tapas', cantidad: 2 }, { producto: 'etiqueta', cantidad: 1 }],
    quantity: undefined, reason: 'daño de empaque', remove: undefined, allUnits: undefined,
  });
  assert.equal(cleanAdvance({ avance: { cantidad: 2 } }).quantity, 2);
});

test('requires an explicit order-scoped final confirmation', () => {
  assert.equal(confirmedByUser('Confirmo preparar la reposición de OP ID 97', 97), true);
  assert.equal(confirmedByUser('Confirmo preparar la reposición de OP-20260924-000097', 97), true);
  assert.equal(confirmedByUser('sí', 97), false);
  assert.equal(confirmedByUser('Confirmo preparar la reposición de OP ID 98', 97), false);
});

test('respects product units and never combines grams with units', () => {
  assert.equal(positiveQuantity('12,5', 'g'), 12.5);
  assert.throws(() => positiveQuantity(1.5, 'und'), /unidades enteras/u);
  const message = guideSummary(
    { id: 97, codigo_orden: 'OP-20260924-000097', producto_nombre: 'Ashwagandha x 60' },
    [
      { producto_id: 1, sku: '00001-TPBI', nombre: 'Tapa', unidad: 'und' },
      { producto_id: 2, sku: '00051-MPASH', nombre: 'Gomas', unidad: 'g' },
    ],
    { entries: { 1: { productId: 1, quantity: 2 }, 2: { productId: 2, quantity: 180 } },
      reason: 'daño', selectedProductId: null },
  );
  assert.match(message, /Total: 2 SKU \| 2 und \+ 180 g/u);
  assert.match(message, /Confirmo preparar la reposición de OP ID 97/u);
  assert.match(message, /no reserva ni descuenta inventario/u);
});

test('guided replenishment uses production-release permission', () => {
  assert.equal(capabilityForAction('GUIAR_REPOSICION_PRODUCCION'), CAPABILITIES.PRODUCTION_RELEASE);
});

test('resolves aliases only within the OP and leaves multiple matching labels ambiguous', () => {
  const oneLabelBom = [
    { id: 27, siigo_code: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA x 60', alias: null },
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: null },
  ];
  assert.deepEqual(contextualProductMatches('etiquetas', oneLabelBom).map(row => row.siigo_code),
    ['00017-ETASH60']);
  assert.deepEqual(contextualProductMatches('tapas', oneLabelBom).map(row => row.siigo_code),
    ['00001-TPBI']);
  const twoLabelsBom = [...oneLabelBom,
    { id: 28, siigo_code: '00018-ETBOS60', nombre: 'ETIQUETA BOOSTER x 60', alias: null }];
  assert.equal(contextualProductMatches('etiquetas', twoLabelsBom).length, 2);
});

test('guided OP draft resolves several spoken aliases against only its BOM', async () => {
  const materials = [
    { producto_id: 27, sku: '00017-ETASH60', nombre: 'ETIQUETA ASHWAGANDHA x 60', unidad: 'und' },
    { producto_id: 19, sku: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', unidad: 'und' },
  ];
  const rows = materials.map(material => ({ id: material.producto_id,
    siigo_code: material.sku, nombre: material.nombre, alias: null }));
  const conn = { execute: async (sql) => {
    if (sql.includes('LEFT JOIN skus')) return [[]];
    if (sql.includes('FROM producto_aliases')) return [[]];
    if (sql.includes('LEFT JOIN producto_aliases')) return [rows];
    throw new Error('Unexpected query');
  } };
  const draft = { entries: {}, reason: null, selectedProductId: null,
    fullBomUnits: null, order: { cantidad_planeada: 2 } };
  await applyAdvance(conn, draft, materials, cleanAdvance({ avance: {
    items: [{ producto: 'etiquetas', cantidad: 1 }, { producto: 'tapas', cantidad: 2 }],
    motivo: 'daño durante producción',
  } }));
  assert.deepEqual(draft.entries, {
    19: { productId: 19, quantity: 2 },
    27: { productId: 27, quantity: 1 },
  });
  assert.equal(draft.reason, 'daño durante producción');
  rows.push({ id: 28, siigo_code: '00018-ETBOS60',
    nombre: 'ETIQUETA BOOSTER x 60', alias: null });
  await assert.rejects(applyAdvance(conn, draft,
    [...materials, { producto_id: 28, sku: '00018-ETBOS60',
      nombre: 'ETIQUETA BOOSTER x 60', unidad: 'und' }],
    cleanAdvance({ avance: { items: [{ producto: 'etiquetas', cantidad: 1 }] } })),
  /varios productos/u);
});
