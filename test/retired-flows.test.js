const test = require('node:test');
const assert = require('node:assert/strict');

const {
  retiredActionMessage,
  approvalsWorkflowEnabled,
  APPROVAL_ACTIONS,
} = require('../api/_lib/retired-flows');

function withEnv(value, fn) {
  const previous = process.env.ENABLE_APPROVALS_WORKFLOW;
  if (value === undefined) delete process.env.ENABLE_APPROVALS_WORKFLOW;
  else process.env.ENABLE_APPROVALS_WORKFLOW = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.ENABLE_APPROVALS_WORKFLOW;
    else process.env.ENABLE_APPROVALS_WORKFLOW = previous;
  }
}

test('approvals workflow is off unless explicitly enabled', () => {
  withEnv(undefined, () => assert.equal(approvalsWorkflowEnabled(), false));
  withEnv('false', () => assert.equal(approvalsWorkflowEnabled(), false));
  withEnv('true', () => assert.equal(approvalsWorkflowEnabled(), true));
});

test('retired actions answer with the vigente flow instead of executing', () => {
  withEnv(undefined, () => {
    for (const action of [...APPROVAL_ACTIONS, 'SOLICITAR_DESPACHO', 'INGRESO_RECEPCION']) {
      const message = retiredActionMessage(action);
      assert.ok(message, `${action} debe estar retirada`);
      assert.match(message, /retirad|ya no se usa/i);
    }
  });
});

test('action matching ignores case and surrounding spaces', () => {
  withEnv(undefined, () => {
    assert.ok(retiredActionMessage('  aprobar_solicitud  '));
  });
});

test('vigente actions are never blocked', () => {
  withEnv(undefined, () => {
    for (const action of [
      'CONFIRMAR_RECEPCION_OC',
      'CONFIRMAR_DESPACHO_SIIGO',
      'LIBERAR_ORDEN_PRODUCCION',
      'CERRAR_ORDEN_PRODUCCION',
      'CONSULTAR_DESPACHOS_PENDIENTES',
      'MODO_CHARLA',
      '',
    ]) {
      assert.equal(retiredActionMessage(action), null, `${action} debe seguir vigente`);
    }
  });
});

test('approval actions can be restored with the escape hatch', () => {
  withEnv('true', () => {
    for (const action of APPROVAL_ACTIONS) {
      assert.equal(retiredActionMessage(action), null);
    }
    // Los flujos anteriores de despacho y recepcion no dependen de esa bandera.
    assert.ok(retiredActionMessage('SOLICITAR_DESPACHO'));
    assert.ok(retiredActionMessage('INGRESO_RECEPCION'));
  });
});
