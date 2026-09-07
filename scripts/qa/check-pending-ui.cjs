// Isolated visual regression: local Vite + synthetic API responses, no real login or outbound API.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '../..');
const port = Number(process.env.QA_UI_PORT || 4187);
const origin = `http://127.0.0.1:${port}`;
const output = path.join(root, 'output/qa/pending-ui-20260906');

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1',
    '--port', String(port), '--strictPort'], { cwd: path.join(root, 'frontend'), windowsHide: true, stdio: 'pipe' });
  let serverError = '';
  server.stderr.on('data', data => { serverError += data.toString(); });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      if (server.exitCode != null) throw new Error(`Local Vite could not start: ${serverError}`);
      try { if ((await fetch(origin)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const results = [];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      await context.addInitScript(() => sessionStorage.setItem('wms_auth', JSON.stringify({
        token: 'synthetic-local-only', user: { nombre: 'QA local', rol: 'admin', capabilities: ['*'] },
      })));
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      let releaseProduct, productSeen;
      const productRequested = new Promise(resolve => { productSeen = resolve; });
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        assert.equal(request.method(), 'GET', 'UI test must never mutate inventory');
        let data = { rows: [], total: 0 };
        if (url.pathname.endsWith('/inventory/summary')) data = {
          total_productos: 2, productos_activos: 2, total_unidades: null, disponible: null, reservado: null,
          cantidades_por_unidad: [{ quantity: 2000, unit: 'g' }, { quantity: 5, unit: 'und' }],
          disponible_por_unidad: [{ quantity: 1500, unit: 'g' }, { quantity: 3, unit: 'und' }],
          reservado_por_unidad: [{ quantity: 500, unit: 'g' }, { quantity: 0, unit: 'und' }],
        };
        if (url.pathname.includes('/inventory/product/')) {
          productSeen();
          await new Promise(resolve => { releaseProduct = resolve; });
          data = { producto: { nombre: 'OLD-PRODUCT-SHOULD-NOT-RENDER' }, stock: [] };
        }
        if (url.pathname.includes('/inventory/lot/')) data = {
          lpn: 'QA-PROVEEDOR', lote_proveedor: 'QA-PROVEEDOR', sku: 'SKU-QA', unit: 'und',
          qty_current: 3, status: 'DISPONIBLE', expiry_date: '2027-11-30',
          partidas_recepcion: [
            { lote_proveedor: 'QA-PROVEEDOR', lote: 'QA-PROVEEDOR', recepcion: 'REC-QA', cantidad: 3,
              condicion: 'DISPONIBLE', ubicacion: 'B13', fecha_venc: '2027-11-30' },
            { lote_proveedor: 'QA-PROVEEDOR', lote: 'RECBLK-CUARENTENA-QA', recepcion: 'REC-QA', cantidad: 1,
              condicion: 'CUARENTENA', ubicacion: 'CUAR-C-1-01', fecha_venc: '2027-11-30', motivo: 'revision calidad' },
            { lote_proveedor: 'QA-PROVEEDOR', lote: 'RECBLK-RECHAZO-QA', recepcion: 'REC-QA', cantidad: 1,
              condicion: 'RECHAZADO', ubicacion: 'CUAR-C-1-01', fecha_venc: '2027-11-30', motivo: 'empaque roto' },
          ],
        };
        if (url.pathname.endsWith('/reception')) data = { rows: [{ id: 1, recepcion_item_id: 10,
          numero: 'REC-QA', estado: 'completada', sku: 'SKU-QA', producto_nombre: 'Producto QA',
          cantidad_rec: 5, cantidad_fisica: 5, cantidad_oc: 5, creado_en: '2026-09-06 12:00:00',
          distribuciones: [
            { lote: 'QA-BUENO', cantidad: 3, condicion: 'DISPONIBLE', ubicacion: 'B13' },
            { lote: 'QA-REVISION', cantidad: 1, condicion: 'CUARENTENA', ubicacion: 'CUAR-C-1-01', motivo: 'revision calidad' },
            { lote: 'QA-RECHAZO', cantidad: 1, condicion: 'RECHAZADO', ubicacion: 'CUAR-C-1-01', motivo: 'empaque roto' },
          ] }], total: 1 };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      });
      await page.goto(`${origin}/inventario`);
      await page.getByText('2.000 g', { exact: true }).waitFor();
      await page.getByText('5 und', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `summary-${viewport.width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Buscar Producto', exact: true }).click();
      await page.getByPlaceholder('Ej: RM-TAP-MED').fill('SKU-QA');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await productRequested;
      await page.getByRole('button', { name: 'Buscar Lote', exact: true }).click();
      releaseProduct();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.getByText('OLD-PRODUCT-SHOULD-NOT-RENDER').count(), 0);
      assert.equal(await page.getByPlaceholder('Ej: L-2024-001').inputValue(), '');
      await page.getByPlaceholder('Ej: L-2024-001').fill('QA-PROVEEDOR');
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await page.getByText('RECBLK-RECHAZO-QA', { exact: true }).waitFor();
      assert.equal(await page.getByText('RECBLK-CUARENTENA-QA', { exact: true }).count(), 1);
      await page.screenshot({ path: path.join(output, `mixed-lot-${viewport.width}.png`), fullPage: true });
      await page.goto(`${origin}/recepciones`);
      await page.getByRole('button', { name: 'Historico', exact: true }).click();
      await page.getByText('QA-RECHAZO', { exact: true }).waitFor();
      assert.equal(await page.getByText('QA-BUENO', { exact: true }).count(), 1);
      assert.equal(await page.getByText('QA-REVISION', { exact: true }).count(), 1);
      await page.screenshot({ path: path.join(output, `reception-${viewport.width}.png`), fullPage: true });
      await page.goto(`${origin}/despachos`);
      await page.getByRole('columnheader', { name: 'Sin asignar', exact: true }).waitFor();
      assert.deepEqual(errors, []);
      results.push({ viewport, checks: ['unit groups', 'late response isolation', 'mixed supplier lot', 'receipt distributions', 'unassigned label'], ok: true });
      await context.close();
    }
    console.log(JSON.stringify({ ok: true, outbound_requests: 0, synthetic_data: true, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server.exitCode == null) {
      await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
