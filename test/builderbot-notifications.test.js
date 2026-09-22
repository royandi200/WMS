const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');

// Base de datos simulada: responde usuarios por rol y registra cada escritura.
const dbPath = path.resolve(__dirname, '../api/_lib/db.js');
const state = { users: [], executed: [], nextId: 1, duplicateEvents: new Set() };

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    createConnection: async () => ({
      async execute(sql, params = []) {
        state.executed.push({ sql, params });
        if (/FROM usuarios u JOIN roles/.test(sql)) {
          const roles = params.map(String);
          return [state.users.filter((u) => {
            const assigned = u.roles || [u.rol];
            return u.activo
              && (u.telefono || u.whatsapp_alias)
              && assigned.some(role => roles.includes(role));
          })];
        }
        if (/INSERT INTO notificaciones_salida/.test(sql)) {
          const key = `${params[0]}|${params[1]}`;
          if (state.duplicateEvents.has(key)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
          state.duplicateEvents.add(key);
          return [{ insertId: state.nextId++ }];
        }
        if (/SELECT id, estado FROM notificaciones_salida/.test(sql)) return [[{ id: 99, estado: 'ENVIADA' }]];
        return [{ affectedRows: 1 }];
      },
      async end() {},
    }),
  },
};

// BuilderBot simulado: captura la peticion en vez de enviarla.
const sent = [];
const originalRequest = https.request;
https.request = (options, onResponse) => {
  const request = new EventEmitter();
  let body = '';
  request.write = chunk => { body += chunk; };
  request.end = () => {
    sent.push({ options, body: JSON.parse(body) });
    const response = new EventEmitter();
    response.statusCode = 200;
    onResponse(response);
    response.emit('end');
  };
  request.destroy = () => {};
  return request;
};
test.after(() => { https.request = originalRequest; });

const { notifyRoles, retryNotification } = require('../api/_lib/builderbot-notifications');

function reset(users) {
  state.users = users;
  state.executed.length = 0;
  state.duplicateEvents.clear();
  sent.length = 0;
}

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const USERS = [
  { id: 5, rol: 'admin', activo: 1, telefono: '3150000059' },
  { id: 18, rol: 'recepcion_cierre', activo: 1, telefono: '573150000067' },
  { id: 20, rol: 'recepcion_cierre', activo: 1, telefono: '315 000 0083' },
  { id: 4, rol: 'recepcion_cierre', activo: 0, telefono: '3150000099' },
  { id: 30, rol: 'despacho', activo: 1, telefono: '12345' },
  { id: 31, rol: 'consulta', roles: ['consulta', 'despacho'], activo: 1, telefono: null, whatsapp_alias: '123456789012345@lid' },
];
const BOT = { BUILDERBOT_API_TOKEN: 'qa-token', BUILDERBOT_BOT_ID: 'qa-bot' };

test('con el corte activado no consulta la base, no registra y no envia', async () => {
  reset(USERS);
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: 'true' }, async () => {
    const result = await notifyRoles({ event: 'production_started:1', roles: ['admin'], text: 'Inicio' });
    assert.deepEqual(result, [{ status: 'disabled' }]);
    assert.equal(state.executed.length, 0);
    assert.equal(sent.length, 0);
  });
});

test('el reintento manual tambien respeta el corte', async () => {
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: 'true' }, async () => {
    await assert.rejects(() => retryNotification(114), error => error.status === 409);
  });
});

test('encendidas envian al endpoint del bot con token, numero normalizado y texto', async () => {
  reset(USERS);
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    const result = await notifyRoles({
      event: 'production_started:89',
      roles: ['admin', 'recepcion_cierre'],
      text: 'Produccion iniciada: OP ID 89',
      excludeUserIds: [18],
    });
    assert.deepEqual(result.map(r => r.status), ['sent', 'sent']);
    assert.equal(sent.length, 2);
    for (const request of sent) {
      assert.equal(request.options.hostname, 'app.builderbot.cloud');
      assert.equal(request.options.path, '/api/v2/qa-bot/messages');
      assert.equal(request.options.method, 'POST');
      assert.equal(request.options.headers['x-api-builderbot'], 'qa-token');
      assert.match(request.body.messages.content, /OP ID 89/);
    }
    // Excluye al autor (18), al inactivo (4) y normaliza los formatos locales.
    assert.deepEqual(sent.map(r => r.body.number).sort(), ['573150000059', '573150000083']);
    // Los destinatarios devueltos van enmascarados.
    assert.ok(result.every(r => /^\d{4}\*{6}\d{2}$/.test(r.recipient)));
    // Queda registro y marca de enviada por destinatario.
    assert.equal(state.executed.filter(e => /INSERT INTO notificaciones_salida/.test(e.sql)).length, 2);
    assert.equal(state.executed.filter(e => /SET estado = 'ENVIADA'/.test(e.sql)).length, 2);
  });
});

test('solo notifica a los roles del evento', async () => {
  reset(USERS);
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    await notifyRoles({ event: 'production_closed:90', roles: ['admin'], fallbackRoles: [], text: 'Cierre' });
    assert.deepEqual(sent.map(r => r.body.number), ['573150000059']);
  });
});

test('el mismo evento no se repite al mismo destinatario', async () => {
  reset(USERS);
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    const input = { event: 'dispatch_ready:67', roles: ['admin'], fallbackRoles: [], text: 'Despacho listo' };
    await notifyRoles(input);
    const second = await notifyRoles(input);
    assert.deepEqual(second.map(r => r.status), ['duplicate']);
    assert.equal(sent.length, 1);
  });
});

test('sin destinatarios en el rol usa el respaldo; sin respaldo registra advertencia', async () => {
  reset(USERS);
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    await notifyRoles({ event: 'x:1', roles: ['alistador'], fallbackRoles: ['admin'], text: 'Respaldo' });
    assert.deepEqual(sent.map(r => r.body.number), ['573150000059']);

    reset(USERS);
    const result = await notifyRoles({ event: 'x:2', roles: ['alistador'], fallbackRoles: [], text: 'Nadie' });
    assert.deepEqual(result, [{ status: 'no_recipient' }]);
    assert.equal(sent.length, 0);
    assert.ok(state.executed.some(e => /Notificacion sin destinatarios/.test(e.sql)));
  });
});

test('un telefono invalido no se envia', async () => {
  reset(USERS.filter(user => user.id !== 31));
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    const result = await notifyRoles({ event: 'dispatch_ready:1', roles: ['despacho'], fallbackRoles: [], text: 'x' });
    assert.deepEqual(result, [{ status: 'no_recipient' }]);
    assert.equal(sent.length, 0);
  });
});

test('un rol adicional recibe push por alias cuando no existe celular', async () => {
  reset(USERS.filter(user => user.id === 31));
  await withEnv({ ...BOT, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    const result = await notifyRoles({ event: 'dispatch_ready:2', roles: ['despacho'], fallbackRoles: [], text: 'x' });
    assert.deepEqual(result.map(item => item.status), ['sent']);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.number, '123456789012345@lid');
  });
});

test('sin token o bot configurado marca error sin romper el flujo', async () => {
  reset(USERS);
  await withEnv({ BUILDERBOT_API_TOKEN: undefined, BUILDERBOT_BOT_ID: undefined, DISABLE_OUTBOUND_NOTIFICATIONS: undefined }, async () => {
    const result = await notifyRoles({ event: 'x:3', roles: ['admin'], fallbackRoles: [], text: 'x' });
    assert.equal(result[0].status, 'error');
    assert.match(result[0].error, /BuilderBot no configurado/);
    assert.ok(state.executed.some(e => /SET estado = 'ERROR'/.test(e.sql)));
    assert.equal(sent.length, 0);
  });
});
