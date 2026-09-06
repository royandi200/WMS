const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractPdfTextLayer, deriveCatalogItemsFromPdfTokens } = require('../api/_lib/pdf-text-layer');
const directory = path.join(__dirname, '../output/pdf/regresion-documental/20260906-r09');
const documents = JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'));

for (const document of documents) {
  test(`R09 native extraction preserves all operational fields across two pages: ${document.tipo}`, async () => {
    const extracted = await extractPdfTextLayer(fs.readFileSync(path.join(directory, document.archivo)));
    const catalog = document.items.map(item => ({ siigo_code: item.sku, nombre: item.descripcion }));
    const items = deriveCatalogItemsFromPdfTokens(extracted.tokens, catalog);
    assert.equal(extracted.pages, 2);
    assert.deepEqual(items.map(item => ({
      sku: item.sku, cantidad: item.cantidad, unidad: item.unidad,
      lote: item.lote, vencimiento: item.fecha_vencimiento,
    })), document.items.map(({ sku, cantidad, unidad, lote, vencimiento }) => ({
      sku, cantidad, unidad, lote, vencimiento,
    })));
  });
}
