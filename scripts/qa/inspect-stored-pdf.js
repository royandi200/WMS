const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  const email = process.env.E2E_DASHBOARD_EMAIL;
  const password = process.env.E2E_DASHBOARD_PASSWORD;
  if (!email || !password) throw new Error('Define E2E_DASHBOARD_EMAIL y E2E_DASHBOARD_PASSWORD');
  const ids = process.argv.slice(2).map(Number);
  if (!ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Indica IDs de borradores QA');
  const base = process.env.WMS_PUBLIC_URL || 'https://wms-seven-ebon.vercel.app';
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20000),
  });
  const session = await login.json();
  const token = session.access_token || session.data?.access_token || session.data?.token || session.token;
  if (!login.ok || !token) throw new Error(`Login HTTP ${login.status}`);
  const directory = path.resolve(__dirname, '../../output/pdf/regresion-documental/20260906-r09');
  const fixtures = JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'));
  for (const id of ids) {
    const response = await fetch(`${base}/api/v1/warehouse-documents?inspect_pdf=${id}`, {
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(40000),
    });
    const result = await response.json();
    if (!response.ok) {
      console.log(JSON.stringify({ at: new Date().toISOString(), id, status: response.status, diagnostics: result.diagnostics || null }));
      process.exitCode = 1;
      continue;
    }
    const data = result.data;
    const fixture = fixtures.find(item => createHash('sha256').update(fs.readFileSync(path.join(directory, item.archivo))).digest('hex') === data.sha256);
    assert.ok(fixture, 'El archivo almacenado no coincide con un PDF QA R09');
    assert.equal(data.diagnostics.status, 'NATIVE_APPLIED');
    const comparable = items => items.map(({ sku, cantidad, unidad, lote, fecha_vencimiento }) => ({ sku, cantidad, unidad, lote, fecha_vencimiento }));
    assert.deepEqual(comparable(data.items), fixture.items.map(({ vencimiento, descripcion, ...item }) => ({ ...item, fecha_vencimiento: vencimiento })));
    assert.equal(data.inventory_changed, false);
    assert.equal(data.draft_changed, false);
    console.log(JSON.stringify({ at: new Date().toISOString(), id, reference: fixture.referencia, ok: true, pages: data.pages, items: data.items.length, sha256: data.sha256, diagnostics: data.diagnostics, inventory_changed: false, draft_changed: false }));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
