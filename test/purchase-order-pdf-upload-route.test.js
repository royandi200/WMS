const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('la web lee el PDF de una OC de proveedor con el mismo lector que WhatsApp', () => {
  const route = read('api', 'v1', 'warehouse-documents.js');
  assert.match(route, /tipo_documento === 'ORDEN_COMPRA'/u);
  assert.match(route, /requireCapability\(req, CAPABILITIES\.RECEPTION_CREATE\)/u);
  assert.match(route, /nativePdfEvidence\(conn, uploadedDocument/u);
  assert.match(route, /registerPurchaseOrderDocumentDraft\(\{[\s\S]*origin: 'DASHBOARD'/u);
  // Rechaza PDFs de otro tipo en vez de crear un borrador equivocado.
  assert.match(route, /markers\.customerPurchaseOrder \|\| markers\.outsourcingExit \|\| markers\.outsourcingReceipt/u);
});

test('el borrador detecta duplicados entre WhatsApp y dashboard', () => {
  const intake = read('api', 'v1', '..', '_lib', 'purchase-order-document-intake.js');
  assert.match(intake, /origen IN \('BUILDERBOT', 'DASHBOARD'\)/u);
  assert.match(intake, /origin === 'DASHBOARD' \? 'DASHBOARD' : 'BUILDERBOT'/u);
});

test('el frontend sube el PDF y abre el borrador para revisar sin crear la OC', () => {
  const api = read('frontend', 'src', 'api', 'purchaseOrders.api.js');
  const page = read('frontend', 'src', 'pages', 'RecepcionPage.jsx');
  assert.match(api, /tipo_documento: 'ORDEN_COMPRA'/u);
  assert.match(api, /timeout: 60000/u);
  assert.match(page, /onUploadPdf=/u);
  assert.match(page, /result\?\.ok && result\.draft\) reviewDraft\(result\.draft\)/u);
});
