const fs = require('fs');
const path = require('path');

function pdfText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^\x20-\x7E]/gu, '')
    .replace(/([\\()])/gu, '\\$1');
}

function textLine(x, y, size, text, bold = false) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(text)}) Tj ET`;
}

function pdfBufferFromCommands(commands) {
  const stream = `${commands.join('\n')}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  let output = '%PDF-1.4\n%WMS-DEMO\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'ascii');
}

function buildPurchaseOrderPdf({ number, supplier, date, title, purpose, items }) {
  const commands = [
    '0.10 0.13 0.17 rg 0 0 595 842 re f',
    '1 1 1 rg 36 42 523 758 re f',
    '0.98 0.45 0.09 rg 36 770 523 30 re f',
    '1 1 1 rg',
    textLine(54, 780, 16, title, true),
    '0.10 0.13 0.17 rg',
    textLine(54, 742, 10, 'DOCUMENTO DE DEMOSTRACION - SIN VALIDEZ COMERCIAL', true),
    textLine(54, 714, 9, `Numero de OC: ${number}`, true),
    textLine(54, 698, 9, `Proveedor: ${supplier}`),
    textLine(54, 682, 9, `Fecha: ${date}`),
    textLine(54, 666, 9, `Flujo: ${purpose}`),
    '0.10 0.13 0.17 rg 54 626 487 24 re f',
    '1 1 1 rg',
    textLine(62, 634, 8, 'SKU', true),
    textLine(170, 634, 8, 'PRODUCTO', true),
    textLine(454, 634, 8, 'CANT.', true),
    textLine(505, 634, 8, 'UND.', true),
  ];
  let y = 604;
  items.forEach((item, index) => {
    const hasTraceData = Boolean(item.documentLot || item.documentExpiry);
    const rowHeight = hasTraceData ? 38 : 24;
    if (index % 2 === 0) commands.push(`0.95 0.96 0.97 rg 54 ${y - rowHeight + 16} 487 ${rowHeight} re f`);
    commands.push('0.10 0.13 0.17 rg');
    commands.push(textLine(62, y, 8, item.sku, true));
    commands.push(textLine(170, y, 8, String(item.description).slice(0, 48)));
    commands.push(textLine(454, y, 8, item.quantity));
    commands.push(textLine(505, y, 8, item.unit));
    if (hasTraceData) {
      commands.push('0.40 0.47 0.55 rg');
      commands.push(textLine(170, y - 14, 7, `Lote propuesto: ${item.documentLot || 'N/A'} | Vence: ${item.documentExpiry || 'N/A'}`));
    }
    y -= hasTraceData ? 42 : 28;
  });
  commands.push('0.40 0.47 0.55 rg');
  commands.push(textLine(54, 92, 8, 'La recepcion fisica y las diferencias se confirman posteriormente en el WMS.'));
  commands.push(textLine(54, 76, 8, 'Este PDF solo representa la expectativa documental de la demostracion.'));
  return pdfBufferFromCommands(commands);
}

function buildWarehouseExitPdf({ number, recipient, date, sender, totalPackages, items }) {
  const totalUnits = items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const commands = [
    '0.10 0.13 0.17 rg 0 0 595 842 re f',
    '1 1 1 rg 36 42 523 758 re f',
    '0.98 0.45 0.09 rg 36 770 523 30 re f',
    '1 1 1 rg',
    textLine(54, 780, 16, 'SALIDA DE BODEGA HACIA 3Q', true),
    '0.10 0.13 0.17 rg',
    textLine(54, 742, 10, 'DOCUMENTO DE DEMOSTRACION - SIN VALIDEZ COMERCIAL', true),
    textLine(54, 714, 9, `Numero de salida: ${number}`, true),
    textLine(54, 698, 9, `Destinatario: ${recipient}`),
    textLine(54, 682, 9, `Fecha: ${date}`),
    textLine(54, 666, 9, `Entrega: ${sender}`),
    textLine(54, 650, 9, `Bultos: ${totalPackages} | Total unidades: ${totalUnits}`),
    '0.10 0.13 0.17 rg 54 610 487 24 re f',
    '1 1 1 rg',
    textLine(62, 618, 8, 'SKU', true),
    textLine(170, 618, 8, 'MATERIAL', true),
    textLine(454, 618, 8, 'CANT.', true),
    textLine(505, 618, 8, 'UND.', true),
  ];
  let y = 588;
  items.forEach((item, index) => {
    if (index % 2 === 0) commands.push(`0.95 0.96 0.97 rg 54 ${y - 8} 487 24 re f`);
    commands.push('0.10 0.13 0.17 rg');
    commands.push(textLine(62, y, 8, item.sku, true));
    commands.push(textLine(170, y, 8, String(item.description).slice(0, 48)));
    commands.push(textLine(454, y, 8, item.quantity));
    commands.push(textLine(505, y, 8, item.unit));
    y -= 28;
  });
  commands.push('0.40 0.47 0.55 rg');
  commands.push(textLine(54, 108, 8, 'Este documento se lee como borrador y no descuenta inventario por si solo.'));
  commands.push(textLine(54, 92, 8, 'La remision operativa WMS asigna lotes FEFO y requiere confirmacion humana.'));
  commands.push(textLine(54, 76, 8, '3Q se registra como custodia externa, no como una bodega o ubicacion del WMS.'));
  return pdfBufferFromCommands(commands);
}

function writePurchaseOrderPdf(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buildPurchaseOrderPdf(data));
  return filePath;
}

module.exports = { buildPurchaseOrderPdf, buildWarehouseExitPdf, writePurchaseOrderPdf };
