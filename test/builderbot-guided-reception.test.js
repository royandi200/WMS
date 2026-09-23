const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceGuidedReception } = require('../api/_lib/builderbot-guided-reception');

function guidedDb() {
  const products = [
    { id: 19, siigo_code: '00001-TPBI', nombre: 'TAPA TARRO CUADRADO BLANCO', alias: 'tapa' },
    { id: 60, siigo_code: '00051-MPASH', nombre: 'GOMAS ASHWAGANDHA', alias: 'gomas ashwa' },
  ];
  const state = { draft: null, inventoryWrites: 0, transactions: 0 };
  const db = {
    async beginTransaction() { state.transactions += 1; },
    async commit() { state.transactions -= 1; },
    async rollback() { state.transactions -= 1; },
    async execute(sql, values = []) {
      if (/INSERT INTO (?:kardex|inventario)|UPDATE (?:inventario|stock)/u.test(sql)) {
        state.inventoryWrites += 1;
        throw new Error('A guided draft must not affect inventory');
      }
      if (/FROM ordenes_compra_proveedor oc WHERE oc\.id/u.test(sql)) {
        return [[{ id: 37, numero: 'OC-37', estado: 'CARGADA', tipo_recepcion: 'INSUMOS_MP' }]];
      }
      if (/FROM recepciones\s+WHERE orden_compra_id = \? AND estado = 'completada'/u.test(sql)) return [[]];
      if (/FROM ordenes_compra_proveedor\s+WHERE id = \? LIMIT 1 FOR UPDATE/u.test(sql)) {
        return [[{ id: 37, numero: 'OC-37', estado: 'CARGADA' }]];
      }
      if (/FROM recepciones\s+WHERE preparacion_clave/u.test(sql)) {
        return [[{ id: 101, numero: 'REC-OC-37-001', orden_compra_id: 37,
          estado: 'borrador', bodega_id: 1 }]];
      }
      if (/FROM recepcion_items ri/u.test(sql)) {
        return [[
          { item_id: 1, producto_id: 19, sku: '00001-TPBI', producto: products[0].nombre,
            cantidad_pendiente: 2, unidad: 'und', lote_documento: 'T-1',
            fecha_vencimiento_documento: '2027-12-31' },
          { item_id: 2, producto_id: 60, sku: '00051-MPASH', producto: products[1].nombre,
            cantidad_pendiente: 100, unidad: 'g', lote_documento: 'G-1',
            fecha_vencimiento_documento: '2027-12-31' },
        ]];
      }
      if (/FROM producto_ubicaciones pu/u.test(sql)) return [[]];
      if (/SELECT id FROM recepciones WHERE id = \? FOR UPDATE/u.test(sql)) return [[{ id: 101 }]];
      if (/FROM recepcion_confirmacion_borradores d/u.test(sql)) {
        return [state.draft ? [{ ...state.draft, recepcion_id: 101, orden_compra_id: 37 }] : []];
      }
      if (/FROM recepcion_confirmacion_borradores\s+WHERE recepcion_id/u.test(sql)) {
        return [state.draft ? [{ ...state.draft }] : []];
      }
      if (/INSERT INTO recepcion_confirmacion_borradores/u.test(sql)) {
        state.draft = { usuario_id: values[2], payload_json: values[3], payload_hash: values[4] };
        return [{ affectedRows: 1 }];
      }
      if (/FROM productos p/u.test(sql) && !/LEFT JOIN producto_aliases/u.test(sql)) {
        return [products.filter(product => product.siigo_code === values[1])];
      }
      if (/FROM producto_aliases pa/u.test(sql)) return [[]];
      if (/LEFT JOIN producto_aliases/u.test(sql)) return [products];
      if (/FROM ubicaciones/u.test(sql)) {
        return [[{ id: values[0] === 'A8' ? 8 : 16, codigo: values[0] }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { db, state };
}

test('guided OC reception accumulates audio-sized pieces and only creates a review draft', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  const send = (rawText, avance) => advanceGuidedReception({
    db, user, rawText, params: { avance },
  });
  const first = await send('Empiezo con etapa de OCID 37', { producto: 'etapa' });
  assert.match(first.message, /00001-TPBI/u);
  assert.match(first.message, /Interpreté «etapa»/u);
  assert.match(first.message, /Falta: cantidad, condición, ubicación/u);
  assert.match(first.message, /Lote propuesto por PDF: T-1/u);
  await send('Llegaron dos', { cantidad: 2 });
  await send('Están disponibles', { condicion: 'DISPONIBLE' });
  const next = await send('En la ubicación A8', { ubicacion: 'A8' });
  assert.match(next.message, /00051-MPASH/u);
  const preview = await send('De gomas, cien gramos disponibles en B16', {
    producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16',
  });
  assert.equal(preview.requires_confirmation, true);
  assert.match(preview.message, /Confirmo la recepcion OC ID 37/u);
  assert.match(preview.message, /propuesto por PDF/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.equal(state.inventoryWrites, 0);
  assert.equal(state.transactions, 0);
});

test('guided OC reception refuses to infer a new order from model memory alone', async () => {
  const { db, state } = guidedDb();
  await assert.rejects(
    advanceGuidedReception({ db, user: { id: 5 }, rawText: 'Empecemos con las tapas',
      params: { orden_compra_id: 37, avance: { producto: 'tapas' } } }),
    error => error.status === 409 && /OC ID N/u.test(error.message)
  );
  assert.equal(state.draft, null);
});

test('guided OC reception never reassigns an active draft to another operator', async () => {
  const { db } = guidedDb();
  await advanceGuidedReception({ db, user: { id: 5 }, rawText: 'OC ID 37',
    params: { avance: { producto: 'tapa' } } });
  await assert.rejects(
    advanceGuidedReception({ db, user: { id: 6 }, rawText: 'OC ID 37',
      params: { avance: { producto: 'tapa' } } }),
    error => error.status === 409 && /otro usuario/u.test(error.message)
  );
});

test('guided OC reception asks why a partial quantity differs from the order', async () => {
  const { db, state } = guidedDb();
  const response = await advanceGuidedReception({ db, user: { id: 5 },
    rawText: 'OC ID 37: llegó una tapa disponible en A8',
    params: { avance: { producto: 'tapa', cantidad: 1, condicion: 'DISPONIBLE', ubicacion: 'A8' } },
  });
  assert.match(response.message, /motivo de la diferencia frente a la OC/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 2);
  assert.equal(state.inventoryWrites, 0);
});

test('guided OC reception can correct its own preview without confirming inventory', async () => {
  const { db, state } = guidedDb();
  const user = { id: 5 };
  await advanceGuidedReception({ db, user, rawText: 'OC ID 37',
    params: { avance: { producto: 'tapa', cantidad: 2, condicion: 'DISPONIBLE', ubicacion: 'A8' } },
  });
  await advanceGuidedReception({ db, user, rawText: 'Gomas, cien disponibles en B16',
    params: { avance: { producto: 'gomas', cantidad: 100, condicion: 'DISPONIBLE', ubicacion: 'B16' } },
  });
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  const corrected = await advanceGuidedReception({ db, user,
    rawText: 'Corrige las tapas: recibí una, faltó otra',
    params: { correccion: true, avance: { producto: 'tapa', cantidad: 1,
      motivo_diferencia: 'Faltó una unidad' } },
  });
  assert.equal(corrected.requires_confirmation, true);
  assert.match(corrected.message, /00001-TPBI.*1 und/u);
  assert.equal(JSON.parse(state.draft.payload_json).version, 1);
  assert.equal(state.inventoryWrites, 0);
});
