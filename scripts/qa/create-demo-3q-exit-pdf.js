const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildWarehouseExitPdf } = require('./demo-pdf');

const ITEMS = [
  { sku: '00001-TPBI', description: 'TAPA TARRO CUADRADO BLANCO (60 UNID)', quantity: 4, unit: 'und' },
  { sku: '00006-TRP', description: 'TARRO CUADRADO x 60', quantity: 4, unit: 'und' },
  { sku: '00018-ETBOS60', description: 'ETIQUETA BOOSTER x 60', quantity: 4, unit: 'und' },
  { sku: '00035-LNTP60', description: 'LINER TARRO x 60', quantity: 4, unit: 'und' },
];

function argument(name, fallback = '') {
  return String(process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback).trim();
}

function normalizeRun(value) {
  const run = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/u.test(run)) throw new Error('Usa --run=IDENTIFICADOR con 3 a 30 letras, numeros o guiones');
  return run;
}

function main() {
  const run = normalizeRun(argument('run'));
  const date = argument('date');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error('Usa --date=YYYY-MM-DD');
  const number = `DEMO-${run}-SALIDA-3Q`;
  const outputDirectory = path.resolve(__dirname, `../../output/pdf/demo-${run.toLowerCase()}`);
  const filePath = path.join(outputDirectory, `${number}.pdf`);
  const pdf = buildWarehouseExitPdf({
    number,
    recipient: '3Q - MAQUILA EXTERNA',
    date,
    sender: 'SOFI - ADMINISTRADORA',
    totalPackages: 1,
    items: ITEMS,
  });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(filePath, pdf);
  console.log(JSON.stringify({
    ok: true,
    databaseChanged: false,
    number,
    file: filePath,
    items: ITEMS.length,
    totalUnits: ITEMS.reduce((total, item) => total + item.quantity, 0),
    sha256: crypto.createHash('sha256').update(pdf).digest('hex'),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
