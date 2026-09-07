const OPERATIONS = Object.freeze({
  LIBERAR_ORDEN_PRODUCCION: {
    flag: 'confirmar_nueva_orden', alias: 'confirm_new_order', base: 'id_orden_existente',
    noun: '(?:produccion|orden(?: de produccion)?)',
    reference: '(?:OP-[A-Z0-9-]+|(?:orden\\s+)?ID\\s+[1-9]\\d*)',
    example: 'confirma una nueva produccion adicional para la orden ID que mostro WMS',
  },
  GESTION_DEVOLUCION: {
    flag: 'confirmar_nueva_devolucion', alias: 'confirm_new_return', base: 'id_devolucion_existente',
    noun: 'devolucion', reference: '(?:DEV-[A-Z0-9-]+|(?:devolucion\\s+)?ID\\s+[1-9]\\d*)',
    example: 'confirma una nueva devolucion adicional como la devolucion que mostro WMS, indicando su ID o codigo',
  },
});

const reject = message => Object.assign(new Error(message), { status: 409 });

function currentText(rawBody, info) {
  // Prefer independently transported text. Never substitute model prose/params
  // for a missing current message; legacy BBC still carries it in info.body.
  for (const source of [rawBody, info]) {
    for (const key of ['body', 'text', 'query']) {
      if (typeof source?.[key] === 'string') return source[key];
    }
  }
  return '';
}

function additionalOperationInput(action, params, rawBody, info) {
  const operation = OPERATIONS[action];
  if (!operation) return params;
  const clean = { ...params, [operation.flag]: false };
  delete clean[operation.alias];
  delete clean[operation.base];
  const text = currentText(rawBody, info).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ');
  const claimed = params[operation.flag] === true || params[operation.alias] === true;
  const confirmation = /\bconfirm(?:o|a|ar)\b/i.test(text);
  const additional = /\b(?:nuev[oa]|otr[oa]|adicional)\b/i.test(text);
  if ((!text && claimed) || ((claimed || confirmation) && /\b(?:no|nunca|cancel\w*)\b/i.test(text))) {
    throw reject('No se autorizo una operacion adicional. Falta una confirmacion actual o fue negada/cancelada. No se modifico inventario.');
  }
  // A normal request remains subject to the existing duplicate detector even
  // when the model adds a bypass flag (RI-004/008).
  if (!confirmation || !additional) return clean;
  const pattern = new RegExp(
    `^(?:si[, ]+)?confirm(?:o|a|ar) (?:un[ao] )?(?:nuev[oa]|otr[oa]) ${operation.noun}` +
    `(?: adicional)? (?:como|para|respecto a) (?:(?:el|la) )?(?:orden |devolucion )?` +
    `(${operation.reference})[.!]*$`, 'i'
  );
  const match = text.match(pattern);
  if (!match) {
    throw reject(`Para autorizar otra operacion, ${operation.example}. No se modifico inventario.`);
  }
  const selected = match[1].toUpperCase();
  const id = selected.match(/\bID\s+(\d+)$/)?.[1];
  if ((id && !Number.isSafeInteger(Number(id))) || selected.length > 80) {
    throw reject('Selecciona un ID o codigo valido del registro mostrado por WMS.');
  }
  return { ...clean, [operation.flag]: true, [operation.base]: id || selected };
}

module.exports = { additionalOperationInput };
