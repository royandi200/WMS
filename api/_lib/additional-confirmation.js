const crypto = require('crypto');

const BASES = Object.freeze({
  PRODUCCION: ['ordenes_produccion', 'codigo_orden'],
  MERMA: ['mermas', 'numero'],
  DEVOLUCION: ['devoluciones', 'numero'],
  MATERIAL: ['movimientos', 'id'],
});

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value === undefined ? null : value;
}

// The caller owns the transaction. Its rollback also releases an unused confirmation.
async function beginAdditionalConfirmation(conn, { kind, userId, base, payload }) {
  if (!BASES[kind] || !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
    throw conflict('Confirmacion adicional invalida');
  }
  const reference = String(base || '').trim();
  if (!reference || reference.length > 80) {
    throw conflict('Falta seleccionar el registro existente para confirmar una operacion adicional. No inventes un codigo nuevo.');
  }
  const [table, code] = BASES[kind];
  const [bases] = await conn.execute(
    `SELECT id FROM ${table} WHERE id = ? OR ${code} = ? LIMIT 2`,
    [/^\d+$/.test(reference) ? Number(reference) : 0, reference]
  );
  if (bases.length !== 1) throw conflict('No fue posible identificar un unico registro base');
  const key = [kind, Number(userId), Number(bases[0].id)];
  const hash = crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  // Unique-key contention serializes retries before any stock locks or validations.
  await conn.execute(
    `INSERT INTO confirmaciones_adicionales (tipo, usuario_id, registro_base_id, payload_hash)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tipo = VALUES(tipo)`,
    [...key, hash]
  );
  const [rows] = await conn.execute(
    `SELECT payload_hash, resultado FROM confirmaciones_adicionales
     WHERE tipo = ? AND usuario_id = ? AND registro_base_id = ? FOR UPDATE`, key
  );
  if (rows.length !== 1 || rows[0].payload_hash !== hash) {
    throw conflict('Esta confirmacion adicional ya fue utilizada con datos diferentes');
  }
  const stored = rows[0].resultado;
  const result = typeof stored === 'string' ? JSON.parse(stored) : stored;
  if (stored != null && (!result || typeof result !== 'object' || Array.isArray(result))) {
    throw conflict('No fue posible recuperar el resultado de la confirmacion');
  }
  return { key, result: result || null };
}

async function completeAdditionalConfirmation(conn, confirmation, result) {
  if (!confirmation) return;
  const [update] = await conn.execute(
    `UPDATE confirmaciones_adicionales SET resultado = ?, completado_en = NOW()
     WHERE tipo = ? AND usuario_id = ? AND registro_base_id = ? AND resultado IS NULL`,
    [JSON.stringify(result), ...confirmation.key]
  );
  if (update.affectedRows !== 1) throw conflict('La confirmacion adicional ya fue consumida');
}

module.exports = { beginAdditionalConfirmation, completeAdditionalConfirmation };
