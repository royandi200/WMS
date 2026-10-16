const test = require('node:test');
const assert = require('node:assert/strict');
const { advanceDispatchPackaging, pendingDispatchPackagingDraft,
  parseDeclarations } = require('../api/_lib/dispatch-packaging-guide');
const { checkedPackaging } = require('../api/_lib/dispatch-packaging');

function fixture() {
  let saved = null;
  const boxes = [
    { id: 11, sku: '00040-CMV', name: 'CAJA MASTER VINAGRE x 24', class: 'CAJA' },
    { id: 12, sku: '00042-CMCG', name: 'CAJA MASTER CREA GUMS x 24', class: 'CAJA' },
  ];
  const lids = [{ id: 13, sku: '00283-TPDCJM', name: 'TAPA DE CAJA MASTER', class: 'TAPA_CAJA_MASTER' }];
  return {
    async execute(sql, params = []) {
      if (sql.includes('SELECT tipo, referencia_id, payload_json FROM despacho_embalaje_borradores')) {
        return [saved ? [{ payload_json: JSON.stringify(saved) }] : []];
      }
      if (sql.includes('INSERT INTO despacho_embalaje_borradores')) {
        saved = JSON.parse(params[3]);
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('DELETE FROM despacho_embalaje_borradores')) {
        saved = null;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id, estado FROM despachos')) return [[{ id: 60, estado: 'picking' }]];
      if (sql.includes('SELECT id, estado FROM maquila_envios')) return [[{ id: 17, estado: 'BORRADOR' }]];
      if (sql.includes('FROM despacho_embalaje_catalogo c')) {
        return [params[0] === 'CAJA' ? boxes : lids];
      }
      if (sql.includes('FROM stock s')) {
        const id = Number(params[0]);
        return [[{ stock_id: id + 100, producto_id: id, lote: `L-${id}`,
          ubicacion: 'A1', libre: 8, lote_libre: 8, vence: '2028-01-01' }]];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
}

test('interpreta cantidades de cajas y tapas por separado, incluso cero', () => {
  assert.deepEqual(parseDeclarations('0 cajas y 0 tapas'),
    { boxes: [], lids: 0, noBoxes: true, pendingBox: null });
  assert.deepEqual(parseDeclarations('2 cajas master vinagre y 1 tapa de caja master'),
    { boxes: [{ quantity: 2, term: 'master vinagre' }], lids: 1,
      noBoxes: false, pendingBox: null });
});

test('una base sin migrar no interrumpe otros mensajes ni autoriza el despacho', async () => {
  const db = { execute: async () => { throw Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' }); } };
  assert.equal(await pendingDispatchPackagingDraft(db, 4), null);
  await assert.rejects(advanceDispatchPackaging({ db, userId: 4,
    rawText: 'confirma despacho ID 60' }), /missing/u);
});

test('un despacho Siigo exige resumen y segunda confirmación sin inferir capacidad', async () => {
  const db = fixture();
  const base = { db, userId: 4, params: {} };
  const first = await advanceDispatchPackaging({ ...base, rawText: 'Confirma el despacho ID 60' });
  assert.match(first.message, /cuántas cajas/u);
  const choices = await advanceDispatchPackaging({ ...base, rawText: '2 cajas y 1 tapa' });
  assert.match(choices.message, /00040-CMV/u);
  const review = await advanceDispatchPackaging({ ...base, rawText: 'opción 1' });
  assert.match(review.message, /2 und/u);
  assert.match(review.message, /Tapas de caja máster\*: 1 und/u);
  assert.match(review.message, /Verifica si es correcto/u);
  const correction = await advanceDispatchPackaging({ ...base, rawText: '3 cajas' });
  assert.match(correction.message, /00040-CMV\): 3 und/u);
  const final = await advanceDispatchPackaging({ ...base, rawText: 'confirmo despacho ID 60' });
  assert.equal(final.type, 'SIIGO');
  assert.deepEqual(final.packaging.lines.map(line => [line.sku, line.quantity]),
    [['00040-CMV', 3], ['00283-TPDCJM', 1]]);
  assert.deepEqual(checkedPackaging(final.packaging), [
    { stockId: 111, quantity: 3 }, { stockId: 113, quantity: 1 },
  ]);
});

test('una salida 3Q admite cero cajas y cero tapas, pero no otro ID durante el borrador', async () => {
  const db = fixture();
  const base = { db, userId: 4, params: { id_despacho: 17 } };
  await advanceDispatchPackaging({ ...base, rawText: 'Confirma el despacho ID 3Q-17' });
  const review = await advanceDispatchPackaging({ ...base, rawText: '0 cajas y 0 tapas' });
  assert.match(review.message, /0 cajas/u);
  await assert.rejects(
    advanceDispatchPackaging({ ...base, rawText: 'confirmo despacho ID 18' }),
    /no coincide/u
  );
  const final = await advanceDispatchPackaging({ ...base, rawText: 'confirmo despacho ID 3Q-17' });
  assert.equal(final.type, 'MAQUILA_3Q');
  assert.deepEqual(final.packaging.lines, []);
});
