const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  explicitConfirmation,
  explicitPurchaseOrderConfirmation,
  receptionConfirmationKey,
  buildConfirmationItems,
  buildReceptionReview,
  canonicalJson,
  receptionDraftPayload,
  parseReceptionDraft,
  findPreparedReception,
  listAvailablePurchaseOrderReceptions,
  listAvailableOutsourcingReceptions,
} = require('../api/_lib/builderbot-reception');
const { capabilityForAction } = require('../api/_lib/capabilities');
const {
  assertAvailableQuantityWithinExpected,
  newKardexEntryIds,
} = require('../api/_lib/reception-distributions');

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

test('WhatsApp renders a canonical receipt review before inventory confirmation', () => {
  const review = buildReceptionReview(
    { id: 5, numero: 'OC-DEMO-5' },
    { id: 60, numero: 'REC-OC-5-001' },
    [{
      sku: '00051-MPASH',
      producto: 'Gomas Ashwa',
      unidad: 'gr',
      requiere_lote: true,
      distributions: [{
        cantidad: 2000,
        condicion: 'DISPONIBLE',
        ubicacion: 'PPAL-A-1-01',
        lote: 'DEMO-GOMAS-001',
        fecha_venc: '2027-12-31',
      }],
    }]
  );
  assert.match(review, /Resumen de recepcion para OC OC-DEMO-5 \(ID 5\)/u);
  assert.match(review, /2000 gr \| DISPONIBLE \| PPAL-A-1-01 \| lote DEMO-GOMAS-001/u);
  assert.match(review, /No se modifico inventario/u);
  assert.match(review, /Confirmo la recepcion ID 5/u);
});

test('WhatsApp requires physical lot, expiry and location instead of trusting PDF suggestions', async () => {
  const db = {
    async execute(sql) {
      if (/FROM productos p/u.test(sql)) {
        return [[{ id: 104, siigo_code: '00276-PTZNASHWA', nombre: 'ZENOVA ASHWAGANDHA' }]];
      }
      assert.match(sql, /FROM ubicaciones/u);
      return [[{ id: 13, codigo: 'B13' }]];
    },
  };
  const prepared = [{
    item_id: 87,
    producto_id: 104,
    sku: '00276-PTZNASHWA',
    producto: 'ZENOVA ASHWAGANDHA',
    unidad: 'und',
    requiere_lote: true,
    lote_documento: 'DEMO-IO-ZENOVA-001',
    fecha_vencimiento_documento: '2027-11-30',
  }];
  await assert.rejects(buildConfirmationItems(db, prepared, {
    items: [{
      sku: 'zenova ashwagandha',
      distribuciones: [{ cantidad: 5, condicion: 'DISPONIBLE' }],
    }],
  }), /Falta el lote del proveedor/u);
  const items = await buildConfirmationItems(db, prepared, {
    items: [{
      sku: 'zenova ashwagandha',
      distribuciones: [{ cantidad: 5, condicion: 'DISPONIBLE', lote: 'FISICO-001', fecha_vencimiento: '2027-12-15', ubicacion: 'B13' }],
    }],
  });
  assert.equal(items[0].distributions[0].lote, 'FISICO-001');
  assert.equal(items[0].distributions[0].lote_fuente, 'OPERARIO');
  assert.equal(items[0].distributions[0].fecha_venc, '2027-12-15');
  const review = buildReceptionReview(
    { id: 6, numero: 'DEMO-20260902-DOC-IO-001' },
    { id: 61, numero: 'REC-OC-6-001' },
    items
  );
  assert.match(review, /lote fisico FISICO-001 \(PDF: DEMO-IO-ZENOVA-001\)/u);
  assert.match(review, /PDF es una referencia/u);
});

test('WhatsApp receipt draft is canonical, actor-bound and integrity checked', () => {
  const payload = receptionDraftPayload(
    { id: 5 },
    { id: 60 },
    [{ sku: '00051-MPASH', distributions: [{ cantidad: 2000 }] }]
  );
  const payloadJson = canonicalJson(payload);
  const payloadHash = require('node:crypto').createHash('sha256').update(payloadJson).digest('hex');
  const row = { usuario_id: 7, payload_json: payloadJson, payload_hash: payloadHash };
  assert.deepEqual(
    parseReceptionDraft(row, { orderId: 5, receptionId: 60, userId: 7 }),
    payload
  );
  assert.throws(
    () => parseReceptionDraft(row, { orderId: 5, receptionId: 60, userId: 8 }),
    /otro usuario/u
  );
  assert.throws(
    () => parseReceptionDraft({ ...row, payload_hash: '0'.repeat(64) }, {
      orderId: 5, receptionId: 60, userId: 7,
    }),
    /no es valido/u
  );
  const optionalFields = canonicalJson({ lote: undefined, fecha_venc: null, cantidad: 12 });
  assert.deepEqual(JSON.parse(optionalFields), { cantidad: 12, fecha_venc: null });
});

test('multi-item reception assigns a unique tx id to every kardex row', () => {
  const entries = Array.from({ length: 100 }, () => newKardexEntryIds());
  assert.equal(new Set(entries.map(entry => entry.id)).size, 100);
  assert.equal(new Set(entries.map(entry => entry.txId)).size, 100);
  assert.equal(entries.every(entry => entry.id !== entry.txId), true);

  const source = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  assert.equal((source.match(/const kardexIds = newKardexEntryIds\(\);/gu) || []).length, 2);
  assert.doesNotMatch(source, /\[crypto\.randomUUID\(\), receptionTxId,/u);
});

test('reception surplus cannot inflate available inventory', () => {
  assert.doesNotThrow(() => assertAvailableQuantityWithinExpected({
    DISPONIBLE: 10,
    CUARENTENA: 2,
  }, 10, 'SKU-A'));
  assert.throws(
    () => assertAvailableQuantityWithinExpected({ DISPONIBLE: 11 }, 10, 'SKU-A'),
    error => error.status === 409 && /sobrante de SKU-A no puede ingresar como disponible/u.test(error.message)
  );
});

test('receipt distributions use a transactional engine with foreign keys', () => {
  const baseSchema = fs.readFileSync(path.join(__dirname, '../database/08_warehouse_workflows.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../database/24_reception_distributions_atomicity.sql'), 'utf8');
  assert.match(baseSchema, /CREATE TABLE IF NOT EXISTS recepcion_distribuciones[\s\S]+ENGINE=InnoDB;/u);
  assert.match(migration, /ALTER TABLE recepcion_distribuciones ENGINE=InnoDB;/u);
  assert.equal((migration.match(/FOREIGN KEY/gu) || []).length, 4);
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
          fecha_vencimiento: '2027-12-31',
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
          fecha_vencimiento: '2027-12-31',
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
      items: [{ sku: 'SKU-A', distribuciones: [{ cantidad: 1, lote: 'LOT-A', fecha_vencimiento: '2027-12-31', ubicacion: 'PPAL-A-1-01', condicion: 'RECHAZADO', motivo: 'roto' }] }],
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
  const receptionWorkflow = fs.readFileSync(path.join(__dirname, '../api/_lib/builderbot-reception.js'), 'utf8');
  const reception = fs.readFileSync(path.join(__dirname, '../api/v1/reception.js'), 'utf8');
  const purchaseOrders = fs.readFileSync(path.join(__dirname, '../api/v1/purchase-orders.js'), 'utf8');
  const prompt = fs.readFileSync(path.join(__dirname, '../docs/Prompt WMS.txt'), 'utf8');
  const idempotencyMigration = fs.readFileSync(path.join(__dirname, '../database/21_reception_confirmation_idempotency.sql'), 'utf8');
  assert.match(webhook, /workflowFlags\(\)\.allowManualReception/u);
  assert.match(webhook, /confirmReceptionFromWhatsApp/u);
  assert.match(reception, /confirmReceptionForUser/u);
  assert.match(purchaseOrders, /createPurchaseOrderForUser/u);
  assert.match(prompt, /Confirmo la orden de compra ID N/u);
  assert.match(prompt, /Confirmo la recepcion ID N/u);
  assert.match(prompt, /Confirmo la recepcion de ID N/u);
  assert.match(prompt, /No aceptes confirmaciones vagas/u);
  assert.match(prompt, /no lo preguntes ni lo inventes/u);
  assert.match(prompt, /vista previa validada/u);
  assert.match(webhook, /confirmation\.requires_confirmation/u);
  const draftMigration = fs.readFileSync(
    path.join(__dirname, '../database/23_reception_confirmation_drafts.sql'),
    'utf8'
  );
  assert.match(draftMigration, /UNIQUE KEY uk_recepcion_confirmacion_borrador \(recepcion_id\)/u);
  assert.match(draftMigration, /payload_hash CHAR\(64\) NOT NULL/u);
  assert.match(receptionWorkflow, /La vista previa vigente pertenece a otro usuario/u);
  assert.match(receptionWorkflow, /estado = 'CONSUMIDO'/u);
  assert.match(prompt, /todos los productos pendientes/u);
  assert.match(prompt, /Todos son obligatorios y deben provenir de la inspeccion fisica/u);
  assert.match(prompt, /prepara la recepcion ID 5/u);
  assert.match(prompt, /`D11`.*respuesta inmediatamente anterior/su);
  assert.match(prompt, /Esta tolerancia no reemplaza la confirmacion final estricta/u);
  assert.match(prompt, /llegaron completos.*NO son la confirmacion final/su);
  assert.match(prompt, /primer resumen nunca omitas `items`/u);
  assert.match(prompt, /"confirmacion_final": false/u);
  assert.match(prompt, /"sku": "00276-PTZNASHWA"/u);
  assert.match(idempotencyMigration, /UNIQUE KEY uk_recepcion_confirmacion_clave/u);
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

test('available outsourcing receptions expose only product still pending from 3Q', async () => {
  const db = {
    async execute(sql, params) {
      assert.match(sql, /om\.estado IN \('EN_3Q', 'RECIBIDA_PARCIAL'\)/u);
      assert.match(sql, /LIMIT 10/u);
      assert.equal(params, undefined);
      return [[{
        id: 4,
        codigo: 'MQ-3Q-20260902-000004',
        estado: 'EN_3Q',
        orden_compra_id: 7,
        orden_compra_numero: 'DEMO-20260902-OC-3Q-001',
        proveedor_nombre: '3Q',
        cantidad_objetivo: '4.0000',
        cantidad_recibida: '1.0000',
        sku: '00105-PTBOS60',
        producto: 'PRODUCTO TERMINADO BOOSTER X 60',
        requiere_lote: 1,
        unidad: 'und',
      }]];
    },
  };
  const available = await listAvailableOutsourcingReceptions({ db });
  assert.equal(available.length, 1);
  assert.equal(available[0].cantidad_pendiente, 3);
  assert.equal(available[0].tipo_recepcion, 'MAQUILA_3Q');
});
