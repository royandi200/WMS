const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('warehouse map shows reception quarantine without counting it as usable stock', async () => {
  const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
  const authPath = path.resolve(__dirname, '../api/_lib/auth.js');
  const routePath = path.resolve(__dirname, '../api/v1/inventory/mapa.js');
  const oldDb = require.cache[dbPath];
  const oldAuth = require.cache[authPath];
  const oldRoute = require.cache[routePath];
  const queries = [];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async sql => {
      queries.push(sql);
      if (sql.includes('FROM ubicaciones u') && sql.includes('JOIN bodegas b')) return [
        { id: 15, codigo: 'C15', zona: 'C', bodega_id: 1, bodega_codigo: 'BG-PPAL', bodega_nombre: 'Bodega Principal' },
        { id: 16, codigo: 'C16', zona: 'C', bodega_id: 1, bodega_codigo: 'BG-PPAL', bodega_nombre: 'Bodega Principal' },
        { id: 18, codigo: 'C18', zona: 'C', bodega_id: 1, bodega_codigo: 'BG-PPAL', bodega_nombre: 'Bodega Principal' },
      ];
      if (sql.includes('FROM stock s') && sql.includes('GROUP BY s.ubicacion_id')) return [
        { ubicacion_id: 15, cantidad_total: 13800, num_productos: 1,
          detalle_raw: '00050-MPRO|GOMAS PROBIOTICOS|Gómez-L-L24|13800', min_stock_ref: 500 },
      ];
      if (sql.includes('FROM lots l') && sql.includes("l.status IN ('CUARENTENA'")) return [
        { ubicacion_id: 16, sku: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS', unidad: 'g',
          lote: 'Gómez-L-L24', lote_interno: 'RECBLK-test', cantidad: 600, estado: 'CUARENTENA' },
        { ubicacion_id: 15, sku: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS', unidad: 'g',
          lote: 'Otro lote', lote_interno: 'RECBLK-mixed', cantidad: 200, estado: 'RECHAZADO' },
      ];
      return [];
    },
  } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true,
    exports: { cors() {}, requireAuth: async () => ({ id: 1 }) } };
  delete require.cache[routePath];
  try {
    const handler = require(routePath);
    const res = { statusCode: 200, payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; } };
    await handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    const byCode = Object.fromEntries(res.payload.data.ubicaciones.map(row => [row.codigo, row]));
    assert.equal(byCode.C16.estado, 'bloqueado');
    assert.equal(byCode.C16.cantidad_total, 0);
    assert.equal(byCode.C16.cantidad_cuarentena, 600);
    assert.equal(byCode.C16.cantidad_bloqueada, 600);
    assert.deepEqual(byCode.C16.items, []);
    assert.deepEqual(byCode.C16.items_bloqueados[0], {
      sku: '00050-MPRO', nombre: 'GOMAS PROBIOTICOS', lote: 'Gómez-L-L24',
      lote_interno: 'RECBLK-test', unidad: 'g', cantidad: 600, estado: 'CUARENTENA',
    });
    assert.equal(byCode.C15.estado, 'ok');
    assert.equal(byCode.C15.cantidad_total, 13800);
    assert.equal(byCode.C15.cantidad_cuarentena, 0);
    assert.equal(byCode.C15.cantidad_bloqueada, 200);
    assert.equal(byCode.C15.items_bloqueados[0].lote_interno, 'RECBLK-mixed');
    assert.equal(byCode.C18.estado, 'vacio');
    assert.match(queries.find(sql => sql.includes('FROM stock s')), /l\.status NOT IN \('CUARENTENA'/u);
    assert.match(queries.find(sql => sql.includes('FROM lots l')), /recepcion_distribuciones/u);
  } finally {
    if (oldDb) require.cache[dbPath] = oldDb; else delete require.cache[dbPath];
    if (oldAuth) require.cache[authPath] = oldAuth; else delete require.cache[authPath];
    if (oldRoute) require.cache[routePath] = oldRoute; else delete require.cache[routePath];
  }
});
