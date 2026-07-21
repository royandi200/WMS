// POST /api/v1/siigo/retry-sync
// Fase 5 — Cola de reintentos: reenvía movimientos con siigo_sync = 0.
//
// Busca en `movimientos` los registros pendientes de sincronizar con SIIGO
// (siigo_sync = 0), identifica si son de recepcion (entrada) o despacho (salida),
// y llama al helper correspondiente para reenviar.
// Límite por ejecución: 20 movimientos para no saturar la API de SIIGO.
// Solo Admin/Supervisor.

const { cors, requireRole }        = require('../../_lib/auth');
const { query }                    = require('../../_lib/db');
const { pushCompraToSiigo }        = require('../../_lib/siigo.purchases');
const { pushFacturaToSiigo }       = require('../../_lib/siigo.invoices');

const BATCH_LIMIT = 20;

module.exports = async (req, res) => {
  cors(res, 'POST');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await requireRole(req, ['Admin', 'Supervisor']);
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    // Pendientes: siigo_sync=0, agrupados por referencia para no duplicar
    const pending = await query(
      `SELECT DISTINCT referencia_id, referencia_tipo, tipo
       FROM movimientos
       WHERE siigo_sync = 0 AND referencia_id IS NOT NULL
       ORDER BY id ASC
       LIMIT ?`,
      [BATCH_LIMIT]
    );

    if (!pending.length) {
      return res.status(200).json({ ok: true, data: { pendientes: 0, procesados: 0, errores: 0 } });
    }

    let procesados = 0, errores = 0;
    const detalle = [];

    for (const mov of pending) {
      try {
        let result;
        if (mov.tipo === 'entrada' || (mov.referencia_tipo || '').includes('recepcion')) {
          result = await pushCompraToSiigo(mov.referencia_id);
        } else if (mov.tipo === 'salida' || (mov.referencia_tipo || '').includes('despacho')) {
          result = await pushFacturaToSiigo(mov.referencia_id);
        } else {
          // Tipo no manejado — marcar como sync=1 para no bloquear la cola
          await query(
            `UPDATE movimientos SET siigo_sync = 1 WHERE referencia_id = ? AND referencia_tipo = ?`,
            [mov.referencia_id, mov.referencia_tipo]
          );
          result = { skipped: true };
        }
        procesados++;
        detalle.push({ ...mov, resultado: result });
      } catch (err) {
        errores++;
        detalle.push({ ...mov, error: err.message });
        console.error('[retry-sync] error', mov.referencia_tipo, mov.referencia_id, err.message);
      }
    }

    return res.status(200).json({
      ok:   true,
      data: { pendientes: pending.length, procesados, errores, detalle },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[retry-sync]', err.message);
    return res.status(500).json({ ok: false, error: 'Error en cola de reintentos' });
  }
};
