const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeUserPhone } = require('../api/v1/users');

test('dashboard normaliza celulares colombianos antes de guardarlos', () => {
  assert.equal(normalizeUserPhone('315 000 0083'), '573150000083');
  assert.equal(normalizeUserPhone('+57 315 000 0083'), '573150000083');
});

test('dashboard rechaza telefonos que no sirven como destino WhatsApp', () => {
  assert.throws(() => normalizeUserPhone('12345'), error => error.status === 400);
  assert.throws(() => normalizeUserPhone(''), error => error.status === 400);
});

test('la edicion de celular exige capacidad administrativa, evita duplicados y queda auditada', () => {
  const route = fs.readFileSync(path.join(__dirname, '../api/v1/users.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/UsuariosPage.jsx'), 'utf8');
  assert.match(route, /handlePatch[\s\S]*requireCapability\(req, CAPABILITIES\.USERS_MANAGE\)/u);
  assert.match(route, /Este celular ya esta asignado a otro usuario/u);
  assert.match(route, /Cambio de celular de usuario/u);
  assert.match(route, /telefono_nuevo: maskPhone\(phone\)/u);
  assert.match(page, /Agregar celular/u);
  assert.match(page, /updateUserPhone/u);
});
