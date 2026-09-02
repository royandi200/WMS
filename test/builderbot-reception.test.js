const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  explicitConfirmation,
  explicitPurchaseOrderConfirmation,
  receptionConfirmationKey,
  buildConfirmationItems,
  findPreparedReception,
  listAvailablePurchaseOrderReceptions,
} = require('../api/_lib/builderbot-reception');
const { capabilityForAction } = require('../api/_lib/capabilities');

test('WhatsApp purchase order and reception require an exact explicit confirmation', () => {
  assert.equal(explicitPurchaseOrderConfirmation(
    'Confirmo la orden de compra OC-123', 'OC-123', { confirmacion_final: true }
  ), true);
  assert.equal(explicitPurchaseOrderConfirmation(
    'confirmo', 'OC-123', { confirmacion_final: true }
  ), false);
  assert.equal(explicitPurchaseOrderConfirmation(
    'Confirmo la orden de compra OC-999', 'OC-123', { confirmacion_final: true }
  ), false);
  assert.equal(explicitPurchaseOrderConfirmation(
    'Confirmo la orden de compra ID 17', { id: 17, referencia_documento: 'OC-MUY-LARGA-123' },
    { confirmacion_final: true, documento_borrador_id: 17 }
  ), true);
  assert.equal(explicitPurchaseOrderConfirmation(
    'Confirmo la orden de compra ID 18', { id: 17, referencia_documento: 'OC-MUY-LARGA-123' },
    { confirmacion_final: true, documento_borrador_id: 17 }
  ), false);

  assert.equal(explicitConfirmation(
    'Confirmo la recepcion OC-123', 'OC-123', { confirmacion_final: true }
  ), true);
  assert.equal(explicitConfirmation(
    'Confirmo la recepcion OC-123', 'OC-123', { confirmacion_final: false }
  ), false);
  assert.equal(explicitConfirmation(
    'Proceda con OC-123', 'OC-123', { confirmacion_final: true }
  ), false);
  assert.equal(explicitConfirmation(
    'Confirmo la recepcion ID 5', { id: 5, numero: 'OC-MUY-LARGA-456' },
    { confirmacion_final: true, orden_compra_id: 5 }
  ), true);
  assert.equal(explicitConfirmation(
    'Confirmo la recepción de ID 5', { id: 5, numero: 'OC-MUY-LARGA-456' },
    { confirmacion_final: true, orden_compra_id: 5 }
  ), true);
  assert.equal(explicitConfirmation(
    'Confirmo la recepcion ID 50', { id: 5, numero: 'OC-MUY-LARGA-456' },
    { confirmacion_final: true, orden_compra_id: 5 }
  ), false);
});

test('WhatsApp reception confirmation key is stable across harmless ordering changes', () => {
  const first = {
    items: [
      { sku: 'SKU-B', distribuciones: [{ cantidad: 2, lote: 'LOT-B', condicion: 'CUARENTENA', ubicacion: 'CUAR-C-1-01', motivo: 'revision' }] },
      { sku: 'SKU-A', cantidad_recibida: 3, distribuciones: [{ cantidad: 3, lote: 'LOT-A', condicion: 'DISPONIBLE', ubicacion: 'PPAL-A-1-01' }] },
    ],
  };
  const reordered = {
    items: [
      { sku: 'sku-a', distribuciones: [{ quantity: 3, lpn: 'LOT-A', condition: 'disponible', location_code: 'ppal-a-1-01' }] },
      { sku: 'sku-b', distribuciones: [{ quantity: 2, lpn: 'LOT-B', condition: 'cuarentena', location_code: 'cuar-c-1-01', reason: 'revision' }] },
    ],
  };
  assert.equal(receptionConfirmationKey(7, 70, first), receptionConfirmationKey(7, 70, reordered));
  assert.notEqual(receptionConfirmationKey(7, 70, first), receptionConfirmationKey(7, 71, reordered));
  reordered.items[1].distribuciones[0].quantity = 1;
  assert.notEqual(receptionConfirmationKey(7, 70, first), receptionConfirmationKey(7, 70, reordered));
});

test('WhatsApp resolves the only active receipt without asking for its REC code', async () => {
  const db = {
    execute: async (sql, params) => {
      assert.match(sql, /estado IN \('borrador', 'en_proceso'\)/u);
      assert.deepEqual(params, [5]);
      return [[{ id: 60, numero: 'REC-OC-5-001', estado: 'borrador' }]];
    },
  };
  assert.deepEqual(
    await findPreparedReception(db, 5, {}),
    { id: 60, numero: 'REC-OC-5-001', estado: 'borrador' }
  );
});

test('WhatsApp fails closed when an OC has multiple active receipts', async () => {
  const db = {
    execute: async () => [[
      { id: 61, numero: 'REC-OC-5-002', estado: 'borrador' },
      { id: 60, numero: 'REC-OC-5-001', estado: 'borrador' },
    ]],
  };
  await assert.rejects(
    findPreparedReception(db, 5, {}),
    /varias recepciones activas/u
  );
});

test('WhatsApp reception maps visible locations and requires every pending SKU once', async () => {
  const db = {
    async execute(sql, values) {
      if (/FROM productos p/u.test(sql)) {
        const products = {
          'SKU-A': { id: 100, siigo_code: 'SKU-A', nombre: 'Product A' },
          'SKU-B': { id: 101, siigo_code: 'SKU-B', nombre: 'Product B' },
        };
        return [[products[values[1]]].filter(Boolean)];
      }
      assert.match(sql, /FROM ubicaciones/u);
      return [[{ id: values[0] === 'PPAL-A-1-01' ? 1 : 2, codigo: values[0] }]];
    },
  };
  const prepared = [
    { item_id: 10, producto_id: 100, sku: 'SKU-A' },
    { item_id: 11, producto_id: 101, sku: 'SKU-B' },
  ];
  const items = await buildConfirmationItems(db, prepared, {
    items: [
      {
        sku: 'SKU-A',
        cantidad_recibida: 10,
        distribuciones: [{
          cantidad: 10,
          lote: 'LOT-A',
          condicion: 'DISPONIBLE',
          ubicacion: 'PPAL-A-1-01',
        }],
      },
      {
        sku: 'SKU-B',
        cantidad_recibida: 2,
        motivo_diferencia: 'dos unidades en cuarentena',
        distribuciones: [{
          cantidad: 2,
          lote: 'LOT-B',
          condicion: 'CUARENTENA',
          ubicacion: 'CUAR-C-1-01',
          motivo: 'revision de calidad',
        }],
      },
    ],
  });
  assert.deepEqual(items.map(item => item.item_id), [10, 11]);
  assert.equal(items[0].distributions[0].ubicacion_id, 1);
  assert.equal(items[1].distributions[0].ubicacion_id, 2);
  assert.equal(items[1].motivo, 'dos unidades en cuarentena');

  await assert.rejects(
    buildConfirmationItems(db, prepared, {
      items: [{ sku: 'SKU-A', distribuciones: [{ cantidad: 1, lote: 'LOT-A', condicion: 'RECHAZADO', motivo: 'roto' }] }],
    }),
    /Falta confirmar: SKU-B/u
  );
});

test('BuilderBot reception actions share domain handlers and disable free receipt by default', () => {
  for (const action of [
    'CONSULTAR_RECEPCIONES_PENDIENTES',
    'REVISAR_BORRADOR_ORDEN_COMPRA',
    'CONFIRMAR_BORRADOR_ORDEN_COMPRA',
    'PREPARAR_RECEPCION_OC',
    'CONFIRMAR_RECEPCION_OC',
  ]) {
    assert.notEqual(capabilityForAction(action), null);
  }
  const webhook = fs.readFileSync(path.join(__dirname, '../api/v1/webhook/builderbot.js'), 'utf8');
  const reception = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  const purchaseOrders = fs.readFileSync(path.join(__dirname, '../api/v1/purchase-orders.js'), 'utf8');
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../database/21_reception_confirmation_idempotency.sql'), 'utf8');
  assert.match(webhook, /workflowFlags\(\)\.allowManualReception/u);
  assert.match(webhook, /confirmReceptionFromWhatsApp/u);
  assert.match(reception, /confirmReceptionForUser/u);
  assert.match(purchaseOrders, /createPurchaseOrderForUser/u);
  assert.match(prompt, /Confirmo la orden de compra ID N/u);
  assert.match(prompt, /Confirmo la recepcion ID N/u);
  assert.match(prompt, /Confirmo la recepcion de ID N/u);
  assert.match(prompt, /No aceptes confirmaciones vagas/u);
  assert.match(prompt, /no lo preguntes ni lo inventes/u);
  assert.match(prompt, /todos los productos pendientes/u);
  assert.match(prompt, /el WMS creara una partida interna/u);
  assert.match(prompt, /prepara la recepcion ID 5/u);
  assert.match(migration, /UNIQUE KEY uk_recepcion_confirmacion_clave/u);
  assert.match(reception, /confirmation_key/u);
});

test('available receptions expose stable IDs and only real pending balances', async () => {
  let call = 0;
  const db = {
    async execute() {
      call += 1;
      if (call === 1) {
        return [[
          { id: 5, numero: 'OC-LARGA-2026-001', proveedor_nombre: 'Proveedor A', fecha_orden: '2026-09-01', estado: 'CARGADA' },
          { id: 6, numero: 'OC-COMPLETA', proveedor_nombre: 'Proveedor B', fecha_orden: '2026-09-02', estado: 'RECIBIDA' },
        ]];
      }
      if (call === 2) {
        return [[
          { orden_compra_id: 5, producto_id: 10, sku: 'SKU-A', producto: 'Producto A', cantidad_ordenada: 12, unidad: 'und' },
          { orden_compra_id: 5, producto_id: 11, sku: 'SKU-B', producto: 'Producto B', cantidad_ordenada: 2000, unidad: 'gr' },
          { orden_compra_id: 6, producto_id: 12, sku: 'SKU-C', producto: 'Producto C', cantidad_ordenada: 4, unidad: 'und' },
        ]];
      }
      return [[
        { orden_compra_id: 5, producto_id: 10, cantidad_aceptada: 2 },
        { orden_compra_id: 6, producto_id: 12, cantidad_aceptada: 4 },
      ]];
    },
  };

  const available = await listAvailablePurchaseOrderReceptions({ db });
  assert.equal(call, 3);
  assert.equal(available.length, 1);
  assert.equal(available[0].id, 5);
  assert.deepEqual(available[0].items.map(item => [item.sku, item.cantidad_pendiente]), [
    ['SKU-A', 10],
    ['SKU-B', 2000],
  ]);
});
