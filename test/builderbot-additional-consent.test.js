const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { additionalOperationInput } = require('../api/_lib/additional-operation-input');

// Exercise the real webhook dispatch without DB, network or inventory writes.
function harness({ operationError, role = 'admin', pickingNotices, pickingReview } = {}) {
  const calls = [];
  const baseReads = [];
  const logged = [];
  const guideTexts = [];
  const pickCalls = [];
  const productReads = [];
  const errors = [];
  let inboxId = 1;
  let nowMinutes = 0;
  let packagingDraft = null;
  const filename = path.resolve(__dirname, '../api/v1/webhook/builderbot.js');
  const nativeRequire = createRequire(filename);
  const db = {
    async end() {},
    async execute(sql, args) {
      if (sql.includes('INSERT INTO webhook_ingress_inbox')) return [{ insertId: inboxId++ }];
      if (sql.includes('UPDATE webhook_ingress_inbox')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO webhook_logs')) {
        if (args[5] !== 'RECEIVED') logged.push({ actor: args[0], action: args[1],
          payload: args[3], response: args[4], status: args[5], atMinute: nowMinutes });
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('AS revision_vigente')) {
        const row = logged.findLast(entry => entry.actor === args[0] && entry.status === 'PROCESSED'
          && nowMinutes - entry.atMinute <= 24 * 60
          && (!['MODO_CHARLA', 'UNKNOWN'].includes(entry.action)
            || JSON.parse(entry.response)?.context?.stock_production_draft?.status));
        return [row ? [{ ...row, revision_vigente: Number(nowMinutes - row.atMinute <= 45) }] : []];
      }
      if (sql.includes('SELECT action, response FROM webhook_logs')) {
        return [logged.filter(row => row.status === 'PROCESSED').slice(-16).reverse()];
      }
      if (sql.includes('SELECT action, payload, response FROM webhook_logs')) {
        return [logged.filter(row => row.status === 'PROCESSED').slice(-8).reverse()];
      }
      if (sql.includes('SELECT action FROM webhook_logs') && sql.includes('AND action IN')) {
        const row = logged.findLast(entry => entry.actor === args[0] && entry.status === 'PROCESSED'
          && nowMinutes - entry.atMinute <= 120 && sql.includes(`'${entry.action}'`));
        return [row ? [{ action: row.action }] : []];
      }
      if (sql.includes('FROM webhook_logs')) return [logged.length ? [logged.at(-1)] : []];
      if (sql.includes('FROM productos p') && sql.includes('LEFT JOIN skus')) {
        const sku = String(args[1] || '').toUpperCase();
        productReads.push(sku);
        const probiotic = sku.includes('PROBIOT') || sku.includes('00201');
        return [[{ id: probiotic ? 201 : sku.includes('120') ? 120 : 60,
          siigo_code: probiotic ? '00201-PTPBS120' : sku.includes('120') ? '00110-PTASH120' : '00102-PTASH60',
          nombre: probiotic ? 'PROBIOTICOS X 120' : sku.includes('120') ? 'ASHWAGANDHA X 120' : 'ASHWAGANDHA X 60',
          modalidad_operativa: 'PR' }]];
      }
      if (sql.includes('FROM producto_aliases pa')) {
        const term = String(args[0] || '');
        const probiotic = term.includes('probiot') || term.includes('00201');
        return [[{ id: probiotic ? 201 : term.includes('120') ? 120 : 60,
          siigo_code: probiotic ? '00201-PTPBS120' : term.includes('120') ? '00110-PTASH120' : '00102-PTASH60',
          nombre: probiotic ? 'PROBIOTICOS X 120' : term.includes('120') ? 'ASHWAGANDHA X 120' : 'ASHWAGANDHA X 60',
          modalidad_operativa: 'PR' }]];
      }
      if (sql.includes('FROM usuarios u')) return [[{ id: 5, rol_nombre: role }]];
      if (sql.includes('FROM usuario_roles ur')) return [[{ rol: role }]];
      if (pickingNotices && sql.includes('FROM produccion_alistamiento_revisiones')) {
        return [pickingReview && args[0] === 5 ? [pickingReview] : []];
      }
      if (pickingNotices && sql.includes('FROM recepcion_confirmacion_borradores')) return [[]];
      if (pickingNotices && sql.includes('FROM notificaciones_salida')
        && sql.includes('production_released:')) return [pickingNotices.map(id => ({ evento: `production_released:${id}` }))];
      if (sql.includes('FROM bodegas')) return [[{ id: 1 }]];
      if (sql.includes('FROM despachos d')) return [[]];
      if (sql.includes('FROM maquila_envios me')) return [[{
        id: 17, numero: 'REM-3Q-20260910-000017', creado_en: '2026-09-10 16:56:02',
        orden_maquila_id: 16, orden_codigo: 'MQ-3Q-20260910-000016', proveedor_nombre: '3Q QA',
      }]];
      if (sql.includes('FROM maquila_envio_items mei')) return [[{
        maquila_envio_id: 17, sku: '00001-TPBI', producto: 'TAPA TARRO',
        cantidad: 4, lote: 'LOT-3Q-QA', ubicacion: 'A8',
      }]];
      if (sql.includes('FROM ordenes_produccion o')) {
        baseReads.push(args);
        return [[{ id: 79, codigo_orden: 'OP-20260906-000079', cantidad_planeada: 3,
          origen_tipo: 'STOCK_SEGURIDAD', siigo_code: '00102-PTASH60' }]];
      }
      if (sql.includes('FROM devoluciones dv')) {
        baseReads.push(args);
        return [[{ id: 30, numero: 'DEV-E0816E63', cantidad: 1, estado: 'CUARENTENA',
          lote_origen: 'REG-3Q-PT-0906-A', cliente_origen: 'Cliente QA',
          siigo_code: 'SKU-QA', despacho_numero: 'DSP-QA', observaciones: 'empaque danado' }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const mocks = {
    '../../_lib/dispatch-packaging-guide': {
      pendingDispatchPackagingDraft: async () => packagingDraft,
      clearDispatchPackagingDraft: async () => { packagingDraft = null; },
      advanceDispatchPackaging: async ({ rawText, params }) => {
        guideTexts.push(rawText);
        if (!packagingDraft) {
          const typed = rawText.match(/ID\s+(3Q-)?(\d+)/iu);
          packagingDraft = { type: typed?.[1] ? 'MAQUILA_3Q' : 'SIIGO',
            referenceId: Number(typed?.[2] || params.id_despacho),
            expectedQuantity: params.expectedQuantity ?? null, reviewed: false };
          return { message: 'Indica cajas y tapas usadas.' };
        }
        if (/0 cajas y 0 tapas/iu.test(rawText)) {
          packagingDraft.reviewed = true;
          return { message: 'Revisa el embalaje; confirmo despacho ID.' };
        }
        if (!packagingDraft.reviewed) return { message: 'Indica cajas y tapas usadas.' };
        return { type: packagingDraft.type, referenceId: packagingDraft.referenceId,
          expectedQuantity: packagingDraft.expectedQuantity,
          packaging: { boxesDeclared: true, lidsDeclared: true, lines: [] } };
      },
    },
    '../../_lib/builderbot-guided-reception': {
      ...nativeRequire('../../_lib/builderbot-guided-reception'),
      advanceGuidedReception: async input => {
        calls.push(input);
        return { message: 'Ingreso conjunto guardado solo en borrador.', inventory_changed: false,
          reception_id: 101, purchase_order_id: 37, reception_number: 'REC-OC-37-001',
          review_sku: '00001-TPBI', selected_sku: '00001-TPBI',
          batch_captured: input.params.avances?.length || 0 };
      },
    },
    '../../_lib/dispatch-workflow': {
      confirmImportedDispatch: async input => {
        calls.push(input);
        return { despacho_id: 60, numero: 'DSP-QA', lotes: [] };
      },
    },
    '../../_lib/outsourcing-workflow': {
      confirmOutsourcingShipment: async input => {
        calls.push({ ...input, kind: 'outsourcing' });
        return {
          shipment_number: 'REM-3Q-20260910-000017', order_id: 16,
          order_code: 'MQ-3Q-20260910-000016',
          dispatched: [{ sku: '00001-TPBI', cantidad: 4, lote: 'LOT-3Q-QA', ubicacion_origen: 'A8' }],
        };
      },
    },
    '../../_lib/builderbot-reception': {
      ...nativeRequire('../../_lib/builderbot-reception'),
      confirmReceptionFromWhatsApp: async input => {
        calls.push(input);
        return { requires_confirmation: true, inventory_changed: false, message: 'Resumen QA; confirma despues.' };
      },
      confirmOutsourcingReceptionFromWhatsApp: async input => {
        calls.push(input);
        return {
          requires_confirmation: true,
          inventory_changed: false,
          message: 'Resumen 3Q QA; confirma despues.',
          recepcion_id: 80,
          numero: 'REC-3Q-12-001',
          orden_compra_id: 25,
          orden_maquila_id: 12,
          item_count: 1,
        };
      },
    },
    '../../_lib/db': { createConnection: async () => db },
    '../../_lib/auth': { requireWebhookSecret() {} },
    '../customer-orders': { listCustomerOrders: async () => [] },
    '../../_lib/production-workflow': { releaseProductionOrder: async input => {
      calls.push(input);
      return { order_id: 79, order_code: 'OP-79', already_released: true,
        requires_confirmation: !input.confirmNew };
    } },
    ...(pickingNotices ? {
      '../../_lib/production-pick-guide': {
        ...nativeRequire('../../_lib/production-pick-guide'),
        advanceProductionPick: async ({ rawText, userId }) => {
          pickCalls.push({ rawText, userId });
          return { message: 'Las tapas tienen dos partidas. Indica cuál quieres corregir.' };
        },
      },
    } : {}),
    '../../_lib/returns-workflow': {
      ...nativeRequire('../../_lib/returns-workflow'),
      createCustomerReturn: async input => {
        calls.push(input);
        if (operationError) throw operationError;
        return { numero: 'DEV-QA', already_completed: true,
          requires_confirmation: !input.confirmar_nueva_devolucion };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: name => mocks[name] || nativeRequire(name),
    process: { env: {} }, console: { log() {}, warn() {}, error(...args) { errors.push(args.map(String).join(' ')); } }, Buffer,
  }, { filename });
  return { calls, baseReads, guideTexts, pickCalls, productReads, errors,
    advanceMinutes: minutes => { nowMinutes += minutes; }, seedLog(action, text, message) {
    logged.push({ actor: 'QA-ACTOR', action, status: 'PROCESSED', atMinute: nowMinutes,
      payload: JSON.stringify({ from: 'QA-ACTOR', info: { '@ction': action, body: text, text, query: text, params: {} } }),
      response: JSON.stringify({ ok: true, message, mensaje: message, context: {} }) });
  }, async send(action, text, params, outer = {}) {
    let body;
    const res = { setHeader() {}, status() { return this; }, json(value) { body = value; return this; } };
    await module.exports({ method: 'POST', headers: {}, body: {
      from: 'QA-ACTOR', info: { '@ction': action, body: text, text, query: text, params }, ...outer,
    } }, res);
    return body;
  } };
}

test('a misclassified close draft correction reaches picking after a unique release notice', async () => {
  const h = harness({ role: 'alistador', pickingNotices: [121] });
  const phrase = 'Cambia la ubicación de las tapas a A18';
  const result = await h.send('CERRAR_ORDEN_PRODUCCION', phrase, {
    editar_borrador: true, evidencia: phrase, aclarar: '¿Qué partida quieres corregir?',
  }, { body: phrase });
  assert.equal(result.ok, true, result.mensaje);
  assert.match(result.mensaje, /dos partidas/u);
  assert.deepEqual(h.pickCalls, [{ rawText: phrase, userId: 5 }]);
  assert.equal(h.calls.length, 0);
});

test('picking recovery does not reroute a real close, invented correction, or ambiguous pair of notices', async () => {
  const phrase = 'Cambia la ubicación de las tapas a A18';
  for (const scenario of [
    { text: 'Corrige la ubicación del terminado en el cierre de la OP ID 121', notices: [121] },
    { text: phrase, outer: 'Hola', notices: [121] },
    { text: phrase, notices: [] },
    { text: phrase, notices: [121, 122] },
    { text: phrase, notices: [121], role: 'consulta' },
  ]) {
    const h = harness({ role: scenario.role || 'alistador', pickingNotices: scenario.notices });
    const result = await h.send('CERRAR_ORDEN_PRODUCCION', scenario.text, {
      editar_borrador: true, evidencia: phrase, aclarar: '¿Qué partida quieres corregir?',
    }, { body: scenario.outer || scenario.text });
    assert.equal(result.error, 'RBAC_DENIED', scenario.text);
    assert.equal(h.pickCalls.length, 0, scenario.text);
    assert.equal(h.calls.length, 0, scenario.text);
  }
});

test('a numbered reply to the active picking review bypasses a misclassified close edit, not its permissions', async () => {
  const phrase = 'opción 1';
  const misclassified = { editar_borrador: true, evidencia: phrase, aclarar: 'lote' };
  const pickingReview = { order_id: 121, choice_json: JSON.stringify({
    kind: 'lot', options: [{ lot: 'LOT-A18' }], expiresAt: Date.now() + 60_000,
  }) };
  for (const scenario of [
    { review: pickingReview, last: 'CONFIRMAR_MATERIALES_PRODUCCION', routed: true },
    { review: { ...pickingReview, choice_json: null }, last: 'CONFIRMAR_MATERIALES_PRODUCCION', routed: true },
    { review: pickingReview, last: 'AVANZAR_RECEPCION_GUIADA_OC' },
    { review: pickingReview, last: 'CERRAR_ORDEN_PRODUCCION' },
    { review: pickingReview, last: 'CONFIRMAR_MATERIALES_PRODUCCION', role: 'consulta' },
    { review: pickingReview, last: 'CONFIRMAR_MATERIALES_PRODUCCION', outer: 'Hola' },
    { review: null, last: 'CONFIRMAR_MATERIALES_PRODUCCION' },
  ]) {
    const h = harness({ role: scenario.role || 'alistador', pickingNotices: [121], pickingReview: scenario.review });
    h.seedLog(scenario.last, '', 'Resumen QA');
    const result = await h.send('CERRAR_ORDEN_PRODUCCION', phrase, misclassified,
      { body: scenario.outer || phrase });
    assert.equal(result.ok, Boolean(scenario.routed), JSON.stringify({ scenario, result, errors: h.errors }));
    if (!scenario.routed) assert.equal(result.error, 'RBAC_DENIED');
    assert.deepEqual(h.pickCalls, scenario.routed ? [{ rawText: phrase, userId: 5 }] : []);
    assert.equal(h.calls.length, 0);
  }
});

test('N1-05 real webhook: partial intent never reaches dispatch; complete confirmation still works', async () => {
  const h = harness();
  const result = await h.send('CONFIRMAR_DESPACHO_SIIGO',
    'Confirma parcialmente el despacho ID 60 enviando solo 1 unidad de las 2 solicitadas.', { id_despacho: 60 });
  assert.equal(result.ok, false);
  assert.equal(h.calls.length, 0);
  const complete = await h.send('CONFIRMAR_DESPACHO_SIIGO', 'Confirma el despacho ID 60.', { id_despacho: 60 });
  assert.equal(complete.ok, true, complete.mensaje);
  assert.match(complete.mensaje, /Indica cajas y tapas/u);
  assert.equal(h.calls.length, 0);
  const packaging = await h.send('MODO_CHARLA', '0 cajas y 0 tapas', {});
  assert.match(packaging.mensaje, /Revisa el embalaje/u, JSON.stringify({ packaging, guideTexts: h.guideTexts, errors: h.errors }));
  const finalized = await h.send('CONFIRMAR_DESPACHO_SIIGO', 'confirmo despacho ID 60', {});
  assert.equal(finalized.ok, true, finalized.mensaje);
  assert.equal(h.calls.length, 1, JSON.stringify(h.guideTexts));
  assert.equal(h.calls[0].packaging.boxesDeclared, true);
});

test('production destination reply carries only the latest asked product and quantity', async () => {
  const h = harness();
  const first = await h.send('MODO_CHARLA', 'vamos a producir 1 tarro de ashwagandha 120', {});
  assert.equal(first.ok, false);
  assert.match(first.mensaje, /1 und de ashwagandha 120/u);
  assert.equal(h.calls.length, 0);
  const stock = await h.send('MODO_CHARLA', 'stock de seguridad', {});
  assert.equal(stock.ok, true, stock.mensaje);
  assert.match(stock.mensaje, /Revisa la nueva OP antes de liberarla/u);
  assert.equal(h.calls.length, 0);
  const released = await h.send('CONFIRMAR_MATERIALES_PRODUCCION',
    'confirmo crear OP para stock de seguridad', {});
  assert.equal(released.ok, true, released.mensaje);
  assert.deepEqual([h.calls[0].product, h.calls[0].quantity, h.calls[0].originType],
    ['00110-PTASH120', 1, 'STOCK_SEGURIDAD']);

  const second = await h.send('LIBERAR_ORDEN_PRODUCCION',
    'vamos a producir 1 tarro de ashwagandha 60', { id_producto_final: 'ashwagandha 120', cantidad_planificada: 10 });
  assert.equal(second.ok, false);
  const customer = await h.send('MODO_CHARLA', 'pedido de cliente', {});
  assert.equal(customer.ok, true, customer.mensaje);
  assert.match(customer.mensaje, /1 und de ashwagandha 60/u);
  assert.equal(h.calls.length, 1);
});

test('stock OP is previewed, corrected in two messages and released only after confirmation', async () => {
  const h = harness();
  const first = await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Vamos a producir 5 unidades de ashwagandha 60 para stock de seguridad',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
  assert.equal(first.ok, true, first.mensaje);
  assert.match(first.mensaje, /Cantidad planeada: 5 und/u);
  assert.equal(h.calls.length, 0);
  const quantity = await h.send('MODO_CHARLA', 'serán 12 unidades', {});
  assert.match(quantity.mensaje, /Cantidad planeada: 12 und/u);
  assert.equal(h.calls.length, 0);
  const product = await h.send('MODO_CHARLA', 'cambia el producto a probioticos 120', {});
  assert.match(product.mensaje, /PROBIOTICOS X 120 \(00201-PTPBS120\)/u);
  assert.match(product.mensaje, /Cantidad planeada: 12 und/u);
  assert.equal(h.calls.length, 0);
  const released = await h.send('MODO_CHARLA', 'confirmo crear OP para stock de seguridad', {});
  assert.equal(released.ok, true, released.mensaje);
  assert.equal(h.calls.length, 1);
  assert.deepEqual([h.calls[0].product, h.calls[0].quantity, h.calls[0].originType],
    ['00201-PTPBS120', 12, 'STOCK_SEGURIDAD']);
});

test('declarative reference correction preserves the quantity and does not release the stock OP', async () => {
  const h = harness();
  const before = await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Vamos a producir cuatro tarros de probióticos 120 para stock de seguridad', {});
  assert.equal(before.context.stock_production_draft.sku, '00201-PTPBS120');
  const corrected = await h.send('LIBERAR_ORDEN_PRODUCCION', 'La referencia correcta es Ashwagandha x60.',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 4, origen_tipo: 'STOCK_SEGURIDAD' });
  assert.equal(corrected.ok, true, corrected.mensaje);
  assert.equal(corrected.context.stock_production_draft.sku, '00102-PTASH60');
  assert.equal(corrected.context.stock_production_draft.quantity, 4);
  assert.equal(corrected.context.inventory_changed, false);
  assert.equal(h.productReads.at(-1), 'ASHWAGANDHA X60');
  assert.equal(h.calls.length, 0);
});

test('translated English quantity corrects the active stock draft without a clarification loop', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
  const changed = await h.send('MODO_CHARLA', 'The quantity will be 8 units', {});
  assert.match(changed.mensaje, /Cantidad planeada: 8 und/u);
  assert.equal(h.calls.length, 0);
  const yes = await h.send('MODO_CHARLA', 'Sí', {});
  assert.match(yes.mensaje, /Cantidad planeada: 8 und/u);
  assert.match(yes.mensaje, /confirmo esta OP/u);
  assert.equal(h.calls.length, 0);
});

test('quantity-only correction restores an older stock draft without asking for its destination', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Vamos a producir cuatro tarros de Ashwagandha x60 para stock de seguridad', {});
  h.advanceMinutes(49);
  for (let index = 0; index < 18; index++) h.seedLog('MODO_CHARLA', 'Gracias', 'De nada');
  const corrected = await h.send('LIBERAR_ORDEN_PRODUCCION', 'serán 3 tarros, no 4', {
    origen_tipo: 'STOCK_SEGURIDAD', id_producto_final: '00102-PTASH60', cantidad_planificada: 3,
  });
  assert.equal(corrected.ok, true, corrected.mensaje);
  assert.equal(corrected.context.stock_production_draft.sku, '00102-PTASH60');
  assert.equal(corrected.context.stock_production_draft.quantity, 3);
  assert.match(corrected.mensaje, /Destino: stock de seguridad/u);
  assert.equal(corrected.context.inventory_changed, false);
  assert.equal(h.calls.length, 0);
});

test('a stale stock confirmation refreshes the review before a new confirmation can release', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Vamos a producir tres tarros de Ashwagandha x60 para stock de seguridad', {});
  h.advanceMinutes(49);
  const refresh = await h.send('MODO_CHARLA', 'Confirmo esta OP', {});
  assert.match(refresh.mensaje, /Recuperé tu borrador/u);
  assert.equal(refresh.context.stock_production_draft.quantity, 3);
  assert.equal(h.calls.length, 0);
  await h.send('MODO_CHARLA', 'Confirmo esta OP', {});
  assert.equal(h.calls.length, 0);
  const review = await h.send('MODO_CHARLA', 'Revisa el borrador de esta OP', {});
  assert.equal(review.context.stock_production_draft.renewal_required, undefined);
  assert.equal(h.calls.length, 0);
  await h.send('MODO_CHARLA', 'Confirmo esta OP', {});
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].quantity, 3);
  await h.send('MODO_CHARLA', 'Confirmo esta OP', {});
  assert.equal(h.calls.length, 1);
});

test('an unclear additional order request keeps the known preview for a written stock confirmation', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Vamos a producir cuatro tarros de Ashwagandha x60 para stock de seguridad', {});
  const malformed = await h.send('LIBERAR_ORDEN_PRODUCCION', 'Confinimul creare sta ordine',
    { confirmar_nueva_orden: true, id_orden_existente: null });
  assert.match(malformed.mensaje, /confirma por escrito/u);
  assert.equal(malformed.context.stock_production_draft.quantity, 4);
  assert.equal(h.calls.length, 0);
  const correction = await h.send('MODO_CHARLA', 'serán 3 tarros, no 4', {});
  assert.equal(correction.context.stock_production_draft.quantity, 3);
  assert.equal(h.calls.length, 0);
});

test('stock context does not reuse expired, cancelled, unrelated, or another actor’s draft', async () => {
  for (const scenario of ['expired', 'cancelled', 'unrelated', 'other actor']) {
    const h = harness();
    await h.send('LIBERAR_ORDEN_PRODUCCION',
      'Vamos a producir cuatro tarros de Ashwagandha x60 para stock de seguridad', {});
    if (scenario === 'expired') h.advanceMinutes(24 * 60 + 1);
    if (scenario === 'cancelled') await h.send('MODO_CHARLA', 'Cancela esta OP', {});
    if (scenario === 'unrelated') h.seedLog('CONSULTAR_ESTADO_PRODUCCION', 'OP pendientes', 'Resumen de OP');
    const correction = await h.send('LIBERAR_ORDEN_PRODUCCION', 'serán 3 tarros, no 4',
      { origen_tipo: 'STOCK_SEGURIDAD', id_producto_final: '00102-PTASH60', cantidad_planificada: 3 },
      scenario === 'other actor' ? { from: 'QA-OTHER' } : {});
    assert.match(correction.mensaje, /No hay un resumen/u, scenario);
    assert.equal(correction.context.stock_production_draft, undefined, scenario);
    assert.equal(h.calls.length, 0, scenario);
  }
});

test('translated and natural confirmations release only the active reviewed stock OP', async () => {
  for (const phrase of ['Confirm create op for security stock', 'Confirmo esta OP',
    'Autorizo crear la orden', 'Crea esta orden por favor']) {
    const h = harness();
    const absent = await h.send('LIBERAR_ORDEN_PRODUCCION', phrase, {});
    assert.match(absent.mensaje, /No hay un resumen/u, phrase);
    assert.equal(h.calls.length, 0, phrase);
    const preview = await h.send('LIBERAR_ORDEN_PRODUCCION',
      'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
      { id_producto_final: '00102-PTASH60', cantidad_planificada: 5,
        origen_tipo: 'STOCK_SEGURIDAD' });
    assert.match(preview.mensaje, /Revisa la nueva OP/u, phrase);
    h.seedLog('MODO_CHARLA', 'Gracias', 'Con gusto.');
    const released = await h.send('MODO_CHARLA', phrase, {});
    assert.equal(released.ok, true, `${phrase}: ${released.mensaje}`);
    assert.equal(h.calls.length, 1, phrase);
    assert.equal(h.calls[0].product, '00102-PTASH60', phrase);
    assert.equal(h.calls[0].quantity, 5, phrase);
  }
});

test('spoken correction "las unidades eran 7" keeps the active stock destination and product', async () => {
  for (const action of ['LIBERAR_ORDEN_PRODUCCION', 'MODO_CHARLA']) {
    const h = harness();
    const preview = await h.send('LIBERAR_ORDEN_PRODUCCION',
      'Vamos a producir 5 tarros de ashwagandha por 60 para stock de seguridad',
      { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
    assert.match(preview.mensaje, /Cantidad planeada: 5 und/u);
    const corrected = await h.send(action, 'las unidades eran 7',
      { cantidad_planificada: 7 });
    assert.match(corrected.mensaje, /Cantidad planeada: 7 und/u);
    assert.match(corrected.mensaje, /ASHWAGANDHA X 60/u);
    assert.match(corrected.mensaje, /Destino: stock de seguridad/u);
    assert.equal(h.calls.length, 0);
  }
});

test('yes to a previous stock quantity question recovers only an operator-stated quantity', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
  const question = 'Entendido Juan Esteban. ¿Deseas cambiar la cantidad a 8 unidades para la OP de stock de seguridad?';
  h.seedLog('MODO_CHARLA', 'The quantity will be 8 units', question);
  h.seedLog('MODO_CHARLA', 'Sí', question);
  const changed = await h.send('MODO_CHARLA', 'Sí', {});
  assert.match(changed.mensaje, /Cantidad planeada: 8 und/u);
  assert.equal(h.calls.length, 0);
  const released = await h.send('MODO_CHARLA', 'confirmo crear OP para stock de seguridad', {});
  assert.equal(released.ok, true, released.mensaje);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].quantity, 8);
});

test('yes cannot adopt a stock quantity invented by an earlier chatbot question', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
  h.seedLog('MODO_CHARLA', 'Sí',
    '¿Deseas cambiar la cantidad a 8 unidades para la OP de stock de seguridad?');
  await h.send('MODO_CHARLA', 'Sí', {});
  assert.equal(h.calls.length, 0);
});

test('cancelled stock OP cannot be released by a later confirmation', async () => {
  const h = harness();
  await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
  const cancelled = await h.send('MODO_CHARLA', 'cancela esta OP', {});
  assert.match(cancelled.mensaje, /Descarté el borrador/u);
  const late = await h.send('LIBERAR_ORDEN_PRODUCCION', 'confirmo crear OP para stock de seguridad', {});
  assert.match(late.mensaje, /No hay un resumen/u);
  assert.equal(h.calls.length, 0);
});

test('natural order and spoken OPF/OPE/OB/OOB cancellation reach the stock draft even as MODO_CHARLA', async () => {
  for (const phrase of ['cancela esta orden', 'Cancele esta orden',
    'Cancele esta OPF', 'Cancele esta OPE',
    'Cancela esta OB', 'Cancela esta OOB']) {
    const h = harness();
    await h.send('LIBERAR_ORDEN_PRODUCCION',
      'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
      { id_producto_final: '00102-PTASH60', cantidad_planificada: 5,
        origen_tipo: 'STOCK_SEGURIDAD' });
    const cancelled = await h.send('MODO_CHARLA', phrase, {});
    assert.equal(cancelled.ok, true, phrase);
    assert.match(cancelled.mensaje, /Descarté el borrador de la OP/u, phrase);
    assert.equal(h.calls.length, 0, phrase);
  }
});

test('model parameters alone cannot bypass the stock OP preview', async () => {
  const h = harness();
  const first = await h.send('LIBERAR_ORDEN_PRODUCCION',
    'Produce 5 unidades de ashwagandha 60 para stock de seguridad',
    { id_producto_final: '00102-PTASH60', cantidad_planificada: 5, origen_tipo: 'STOCK_SEGURIDAD' });
  assert.match(first.mensaje, /Cantidad planeada: 5 und/u);
  const ambiguous = await h.send('LIBERAR_ORDEN_PRODUCCION', 'confirmo',
    { id_producto_final: '00201-PTPBS120', cantidad_planificada: 20,
      origen_tipo: 'STOCK_SEGURIDAD' });
  assert.equal(ambiguous.ok, false);
  assert.equal(h.calls.length, 0);
  const confirmed = await h.send('MODO_CHARLA', 'confirmo crear OP',
    { id_producto_final: '00201-PTPBS120', cantidad_planificada: 20 });
  assert.equal(confirmed.ok, true, confirmed.mensaje);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].product, '00102-PTASH60');
  assert.equal(h.calls[0].quantity, 5);
});

test('WhatsApp lists and confirms a pending 3Q dispatch through its typed ID', async () => {
  const h = harness({ role: 'despacho' });
  const pending = await h.send('CONSULTAR_DESPACHOS_PENDIENTES', 'despachos pendientes', {});
  assert.equal(pending.ok, true, pending.mensaje);
  assert.match(pending.mensaje, /DSP ID 3Q-17/u);
  assert.match(pending.mensaje, /REM-3Q-20260910-000017/u);
  assert.match(pending.mensaje, /confirma el despacho \*ID 3Q-17\*/u);
  assert.match(pending.mensaje, /\*Picking FEFO\*\n\n1\. \*00001-TPBI\* - TAPA TARRO\n   Cantidad: 4 und\n   Lote: LOT-3Q-QA\n   Ubicación: A8/u);
  assert.match(pending.mensaje, /\*Siguiente paso\*\n\nEscribe: confirma el despacho \*ID 3Q-17\*\./u);
  assert.equal(h.calls.length, 0);

  const prepared = await h.send('CONFIRMAR_DESPACHO_SIIGO', 'Confirma el despacho ID 3Q-17.', { id_despacho: 17 });
  assert.match(prepared.mensaje, /Indica cajas y tapas/u);
  const packaging = await h.send('MODO_CHARLA', '0 cajas y 0 tapas', {});
  assert.match(packaging.mensaje, /Revisa el embalaje/u, JSON.stringify({ packaging, guideTexts: h.guideTexts, errors: h.errors }));
  const confirmed = await h.send('CONFIRMAR_DESPACHO_SIIGO', 'confirmo despacho ID 3Q-17', {});
  assert.equal(confirmed.ok, true, confirmed.mensaje);
  assert.match(confirmed.mensaje, /Salida a maquila 3Q confirmada/u);
  assert.match(confirmed.mensaje, /Despacho: \*DSP ID 3Q-17\* \| REM-3Q-20260910-000017/u);
  assert.match(confirmed.mensaje, /Orden: \*MQ ID 16\* \| MQ-3Q-20260910-000016/u);
  assert.match(confirmed.mensaje, /\*Materiales enviados\*\n\n1\. \*00001-TPBI\*\n   Cantidad: 4 und\n   Lote: LOT-3Q-QA\n   Ubicación de origen: A8/u);
  assert.equal(h.calls[0].kind, 'outsourcing');
  assert.equal(h.calls[0].shipmentId, 17);
});

test('N1-09 real webhook: malformed mixed receipt reaches preview only, with RBAC preserved', async () => {
  const text = 'Para la recepcion OC ID 18 llegaron 5 unidades, 3 disponibles, 1 cuarentena y 1 rechazada.';
  const info = { '@ction': 'CONFIRMAR_RECEPCION_OC', body: text, params: {
    orden_compra_id: 18, confirmacion_final: false, items: [{ sku: 'SKU-QA', cantidad_recibida: 5,
      distribuciones: [3, 1, 1].map((cantidad, i) => ({ cantidad,
        condicion: ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO'][i], lote: 'LOT-QA',
        ubicacion: 'B13', fecha_vencimiento: '2027-11-30', motivo: 'QA' })) }],
  } };
  const malformed = JSON.stringify(info).replace(/\}\]\}\]\}\}$/, '}]}}}');
  for (const role of ['admin', 'alistador']) {
    const h = harness({ role });
    const result = await h.send('', '', {}, { body: text, text, info: malformed });
    assert.equal(result.ok, role === 'admin', result.mensaje);
    assert.equal(h.calls.length, role === 'admin' ? 1 : 0);
    if (h.calls.length) {
      assert.equal(h.calls[0].params.confirmacion_final, false);
      assert.equal(result.context.reception.inventory_changed, false);
      assert.equal(h.calls[0].params.items[0].distribuciones.length, 3);
    }
  }
});

test('RI-006/009: webhook blocks a customer return substituted for production materials or destruction', async () => {
  for (const text of ['Devuelvo 5 gramos de gomas de la orden ID 79',
    'Destruye una unidad de la devolucion ID 30']) {
    const h = harness();
    const result = await h.send('GESTION_DEVOLUCION', text, {
      id_item: 'SKU-QA', cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-QA',
    });
    assert.equal(result.ok, false);
    assert.match(result.mensaje, /No se (?:modificó inventario|registró otra operación)/);
    assert.equal(h.calls.length, 0);
  }
});

test('flat reception traverses real webhook with permissions, totals and preview-only boundaries', async () => {
  const params = { orden_compra_id: 21, confirmacion_final: false,
    partidas: [3, 1, 1].map((cantidad, i) => ({ sku: 'SKU-QA', total_recibido: 5,
      cantidad, condicion: ['DISPONIBLE', 'CUARENTENA', 'RECHAZADO'][i], lote: 'LOT-QA',
      ubicacion: 'B13', fecha_vencimiento: '2027-11-30', motivo: 'QA' })) };
  for (const role of ['admin', 'recepcion_cierre', 'alistador']) {
    const h = harness({ role });
    const result = await h.send('CONFIRMAR_RECEPCION_OC', 'Para la recepcion OC ID 21 llegaron 5 unidades', params);
    assert.equal(result.ok, role !== 'alistador', result.mensaje);
    assert.equal(h.calls.length, role !== 'alistador' ? 1 : 0);
    if (h.calls.length) {
      assert.deepEqual(h.calls[0].params.items[0].distribuciones.map(r => r.cantidad), [3, 1, 1]);
      assert.equal(result.context.reception.inventory_changed, false);
    }
  }
  for (const bad of [{ ...params, confirmacion_final: true }, { ...params, items: [] },
    { ...params, partidas: [{ ...params.partidas[0], cantidad: 6 }] }]) {
    const h = harness();
    assert.equal((await h.send('CONFIRMAR_RECEPCION_OC', 'Confirmo la recepcion OC ID 21', bad)).ok, false);
    assert.equal(h.calls.length, 0);
  }
});

test('guided batch traverses the real webhook with all SKU advances and reception role checks', async () => {
  const params = { avances: [
    { producto: 'tapas', cantidad: 30, condicion: 'DISPONIBLE', ubicacion: 'A8' },
    { producto: 'liner', cantidad_total: 30, partidas: [
      { cantidad: 20, condicion: 'DISPONIBLE', ubicacion: 'B10' },
      { cantidad: 10, condicion: 'CUARENTENA' },
    ] },
    { producto: 'gomas', cantidad: 5400, condicion: 'DISPONIBLE', ubicacion: 'A10' },
  ] };
  for (const role of ['admin', 'recepcion_cierre', 'alistador']) {
    const h = harness({ role });
    const result = await h.send('AVANZAR_RECEPCION_GUIADA_OC',
      'Voy a ingresar tapas, liners y gomas en la recepción preparada', params);
    assert.equal(result.ok, role !== 'alistador', result.mensaje);
    assert.equal(h.calls.length, role !== 'alistador' ? 1 : 0);
    if (h.calls.length) {
      assert.deepEqual(h.calls[0].params.avances, params.avances);
      assert.equal(result.context.reception.inventory_changed, false);
        assert.equal(result.context.reception.requires_confirmation, false);
        assert.equal(result.context.reception.reception_id, 101);
        assert.equal(result.context.reception.purchase_order_id, 37);
        assert.equal(result.context.reception.reception_number, 'REC-OC-37-001');
        assert.equal(result.context.reception.review_sku, '00001-TPBI');
        assert.equal(result.context.reception.selected_sku, '00001-TPBI');
    }
  }
});

test('3Q receipt preview uses its own MQ action and preserves the typed namespace', async () => {
  const params = {
    orden_maquila_id: 12,
    confirmacion_final: false,
    partidas: [{
      sku: '00105-PTBOS60', total_recibido: 2, cantidad: 2,
      condicion: 'DISPONIBLE', lote: 'TRIO-E-3Q-A',
      fecha_vencimiento: '2026-09-14', ubicacion: 'C8',
    }],
  };
  for (const role of ['admin', 'recepcion_cierre', 'alistador']) {
    const h = harness({ role });
    const result = await h.send(
      'CONFIRMAR_RECEPCION_MAQUILA',
      'Recibe el PDF adjunto contra MQ ID 12. Llegaron 2 unidades disponibles en C8.',
      params,
      { document_text: 'LOTE TRIO-E-3Q-A VENCE 2026-09-14' }
    );
    assert.equal(result.ok, role !== 'alistador', result.mensaje);
    assert.equal(h.calls.length, role !== 'alistador' ? 1 : 0);
    if (h.calls.length) {
      assert.equal(h.calls[0].params.orden_maquila_id, 12);
      assert.equal(h.calls[0].params.items[0].cantidad_recibida, 2);
      assert.equal(result.context.reception.inventory_changed, false);
    }
  }
});

test('3Q delivery PDF is grounded before it reaches the inventory-neutral preview', async () => {
  const h = harness({ role: 'recepcion_cierre' });
  const params = {
    tipo_documento: 'RECEPCION_MAQUILA_3Q',
    codigo_maquila: 'MQ-3Q-20260908-000012',
    confirmacion_final: false,
    partidas: [{
      sku: '00105-PTBOS60', total_recibido: 2, cantidad: 2,
      condicion: 'DISPONIBLE', lote: 'TRIO-E-3Q-A',
      fecha_vencimiento: '2026-09-14', ubicacion: 'C8',
    }],
  };
  const documentText = [
    'ENTREGA DE PRODUCTO TERMINADO - MAQUILA 3Q',
    'MQ-3Q-20260908-000012',
    '00105-PTBOS60 2 DISPONIBLE TRIO-E-3Q-A 2026-09-14 C8',
  ].join('\n');
  const result = await h.send(
    'REGISTRAR_VISTA_PREVIA_RECEPCION_MAQUILA_DOCUMENTO',
    '_event_document__00000000-0000-0000-0000-000000000000',
    params,
    { document_text: documentText }
  );
  assert.equal(result.ok, true, result.mensaje);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].params.codigo_maquila, 'MQ-3Q-20260908-000012');
  assert.equal(h.calls[0].params.items[0].cantidad_recibida, 2);
  assert.equal(result.context.reception.inventory_changed, false);
});

test('webhook hides SQL failures and does not automatically repeat a failed inventory operation', async () => {
  const h = harness({ operationError: Object.assign(new Error('SQL internal details'), {
    code: 'ER_LOCK_DEADLOCK', sql: 'UPDATE private_table SET value=secret',
  }) });
  const result = await h.send('GESTION_DEVOLUCION', 'Registra una devolucion del cliente', {
    id_item: 'SKU-QA', cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-QA',
  });
  assert.equal(result.ok, false);
  assert.match(result.mensaje, /concurrencia/);
  assert.doesNotMatch(JSON.stringify(result), /private_table|secret|SQL internal/);
  assert.equal(h.calls.length, 1);
});

test('consent accepts accents/case and short IDs, but not another operation or two bases', () => {
  const action = 'GESTION_DEVOLUCION';
  const result = additionalOperationInput(action, {}, { text: 'S\u00ed, confirmo otra devoluci\u00f3n como ID 30.' });
  assert.equal(result.confirmar_nueva_devolucion, true);
  assert.equal(result.id_devolucion_existente, '30');
  for (const text of ['Confirma otra produccion como OP-79.',
    'Confirma otra devolucion como DEV-30 y DEV-31.',
    'Confirma otra devolucion como ID 9007199254740993.']) {
    assert.throws(() => additionalOperationInput(action, {}, { text }), error => error.status === 409);
  }
});

test('empty independent text and model prose cannot supply missing confirmation evidence', () => {
  const params = { confirmar_nueva_devolucion: true, id_devolucion_existente: 30 };
  const text = 'Confirma otra devolucion como ID 30.';
  assert.throws(() => additionalOperationInput('GESTION_DEVOLUCION', params,
    { text: '' }, { body: text }), /No se autorizo/);
  assert.throws(() => additionalOperationInput('GESTION_DEVOLUCION', params,
    {}, { mensaje: text, params: { body: text } }), /No se autorizo/);
});

test('unrelated actions and original operational fields remain unchanged', () => {
  const params = { cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-1' };
  assert.equal(additionalOperationInput('REPORTE_MERMA', params, {}), params);
  const clean = additionalOperationInput('GESTION_DEVOLUCION', params, { text: 'Registra la devolucion' });
  assert.deepEqual(params, { cantidad: 1, estado: 'CUARENTENA', lote_origen: 'LOT-1' });
  assert.deepEqual(clean, { ...params, confirmar_nueva_devolucion: false });
});

const scenarios = [
  { name: 'production', action: 'LIBERAR_ORDEN_PRODUCCION',
    text: 'Cambio el destino: produce tres tarros de ashwagandha 60 para stock de seguridad.',
    params: { id_producto_final: '00102-PTASH60', cantidad_planificada: 3, origen_tipo: 'STOCK_SEGURIDAD' },
    flags: { confirmar_nueva_orden: true, id_orden_existente: 79 },
    confirmation: 'Confirma una nueva produccion adicional para la orden ID 79.',
    flag: 'confirmNew', base: 'existingOrderId', expectedBase: '79' },
  { name: 'return', action: 'GESTION_DEVOLUCION',
    text: 'Registra una devolucion del cliente del despacho ID 58: 1 unidad de Booster60, lote REG-3Q-PT-0906-A, por empaque danado. Dejar en cuarentena en CUAR-C-1-01.',
    params: { id_item: 'SKU-QA', id_despacho: 'DSP-QA', cantidad: 1, estado: 'CUARENTENA', lote_origen: 'REG-3Q-PT-0906-A' },
    flags: { confirmar_nueva_devolucion: true, id_devolucion_existente: 'DEV-E0816E63' },
    confirmation: 'Confirmo una nueva devolucion adicional como DEV-E0816E63.',
    flag: 'confirmar_nueva_devolucion', base: 'id_devolucion_existente', expectedBase: '30' },
];

for (const s of scenarios) {
  test(`${s.name}: stale BBC document event is not human text or consent`, async () => {
    const marker = '_event_document__d0df89e8-fa7a-417f-949b-1094374a38e1';
    const outer = { body: marker, text: marker, query: marker };
    const h = harness();
    const result = await h.send(s.action, s.confirmation, {}, outer);
    assert.equal(result.ok, true, result.mensaje);
    assert.equal(h.calls[0][s.flag], true);
    const repeat = harness();
    await repeat.send(s.action, s.text, { ...s.params, ...s.flags }, outer);
    if (s.name === 'production') assert.equal(repeat.calls.length, 0);
    else assert.equal(repeat.calls[0][s.flag], false);
    const missing = harness();
    assert.equal((await missing.send(s.action, '', s.flags, outer)).ok, false);
    assert.equal(missing.calls.length, 0);
    const denied = harness();
    assert.equal((await denied.send(s.action, s.confirmation, s.flags,
      { body: marker, text: 'No confirmo otra operacion.' })).ok, false);
    assert.equal(denied.calls.length, 0);
  });

  test(`${s.name}: N1-04 exact BBC timestamp after PDF preserves explicit consent and base on replay`, async () => {
    const h = harness();
    const marker = '_event_document__cc05fd12-630d-4b49-b065-f9da56993581';
    const text = '[Sunday, September 6, 2026 23:34:14]: ' + s.confirmation;
    for (let i = 0; i < 2; i++) {
      const result = await h.send(s.action, text, {}, { body: marker, text: marker, query: marker });
      assert.equal(result.ok, true, result.mensaje);
      assert.equal(h.calls[i][s.flag], true);
      assert.equal(String(h.calls[i][s.base]), s.expectedBase);
    }
  });

  test(`${s.name}: RI-004/008 repeated text cannot authorize model-generated additional flags`, async () => {
    const h = harness();
    assert.equal((await h.send(s.action, s.text, s.params)).ok, true);
    assert.equal((await h.send(s.action, s.text, { ...s.params, ...s.flags, confirm_new_return: true })).ok, true);
    if (s.name === 'production') {
      assert.equal(h.calls.length, 0);
      return;
    }
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1][s.flag], false);
    assert.notEqual(h.calls[1].confirm_new_return, true);
    assert.equal(h.baseReads.length, 0);
  });

  test(`${s.name}: explicit confirmation works without model flags and uses the human-selected base`, async () => {
    const h = harness();
    const result = await h.send(s.action, s.confirmation, {});
    assert.equal(result.ok, true, result.mensaje);
    assert.equal(h.calls[0][s.flag], true);
    assert.equal(String(h.calls[0][s.base]), s.expectedBase);
    assert.equal(h.baseReads.length, 1);
  });

  test(`${s.name}: missing text or negated/quoted/ambiguous consent cannot invoke mutation`, async () => {
    for (const text of ['', `No ${s.confirmation.toLowerCase()}`, `Ayer dije: ${s.confirmation}`,
      `¿${s.confirmation}?`, s.confirmation.replace(/(?:ID 79|DEV-E0816E63)/, ''),
      `${s.confirmation} Pero cambia la cantidad a 5.`]) {
      const h = harness();
      const result = await h.send(s.action, text, { ...s.params, ...s.flags });
      assert.equal(result.ok, false, text);
      assert.equal(h.calls.length, 0, text);
      assert.equal(h.baseReads.length, 0, text);
    }
  });

  test(`${s.name}: independent current text takes precedence over a generated confirmation`, async () => {
    const h = harness();
    const result = await h.send(s.action, s.confirmation, { ...s.params, ...s.flags }, { text: s.text });
    // Production may also reject inconsistent origin evidence. Either way,
    // model-only consent must never reach the additional-operation branch.
    if (h.calls.length) assert.equal(h.calls[0][s.flag], false);
    else assert.equal(result.ok, false);
    assert.equal(h.baseReads.length, 0);
  });

  test(`${s.name}: selected base is stable on replay despite an invented model ID`, async () => {
    const h = harness();
    for (const id of ['INVENTED', '999']) {
      await h.send(s.action, s.confirmation, { ...s.flags,
        [s.name === 'production' ? 'id_orden_existente' : 'id_devolucion_existente']: id });
    }
    assert.equal(h.calls.length, 2);
    assert.equal(String(h.calls[0][s.base]), s.expectedBase);
    assert.equal(String(h.calls[1][s.base]), s.expectedBase);
  });
}
