const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[match[1]] ||= value;
  }
}

const STALE_REQUESTS = [
  'REQ-000001', 'REQ-000002', 'REQ-000003', 'REQ-000004', 'REQ-000005',
  'REQ-000041', 'REQ-000042', 'REQ-000044', 'REQ-000045', 'REQ-000047',
];

async function main() {
  loadEnv();
  const apply = process.argv.includes('--apply');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || process.env.MYSQL_HOST,
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER,
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
    connectTimeout: 15000,
  });

  try {
    await conn.beginTransaction();
    const placeholders = STALE_REQUESTS.map(() => '?').join(',');
    const [requests] = await conn.execute(
      `SELECT codigo_solicitud, accion, estado FROM aprobaciones
        WHERE codigo_solicitud IN (${placeholders}) FOR UPDATE`,
      STALE_REQUESTS
    );
    const [pending] = await conn.execute(
      `SELECT codigo_solicitud, accion, estado FROM aprobaciones
        WHERE estado = 'PENDIENTE' AND creado_en < '2026-08-01' FOR UPDATE`
    );

    const [anomalousWaste] = await conn.execute(
      `SELECT m.id, m.numero, m.cantidad, m.motivo
         FROM mermas m
        WHERE m.numero = 'MER-1785879881029'
          AND m.cantidad = 99
          AND m.motivo = 'WMSFLOW-QA intento sin stock'
          AND NOT EXISTS (
            SELECT 1 FROM movimientos mv
             WHERE mv.referencia_tipo = 'merma_bodega' AND mv.referencia_id = m.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM kardex k WHERE k.reference = CONCAT('merma:', m.numero)
          )
        FOR UPDATE`
    );

    const [accidentalDispatch] = await conn.execute(
      `SELECT d.id, d.numero, d.bodega_id, di.id AS item_id, di.producto_id,
              di.lote, di.cantidad_des
         FROM despachos d
         JOIN despacho_items di ON di.despacho_id = d.id
        WHERE d.numero = 'DSP-1785941723310'
          AND d.observaciones = 'Despacho aprobado desde dashboard/API'
          AND d.cliente_nombre = 'Cliente QA'
        FOR UPDATE`
    );
    let dispatchReturns = 0;
    if (accidentalDispatch.length) {
      const [returnRows] = await conn.execute(
        `SELECT COUNT(*) AS total FROM devoluciones WHERE despacho_id = ?`,
        [accidentalDispatch[0].id]
      );
      dispatchReturns = Number(returnRows[0]?.total || 0);
      if (dispatchReturns) {
        throw new Error('El despacho QA accidental ya tiene devoluciones y no se puede revertir automaticamente');
      }
    }

    if (apply) {
      if (pending.length) {
        await conn.execute(
          `UPDATE aprobaciones
              SET estado = 'EXPIRADO',
                  motivo_rechazo = 'Limpieza QA previa a demostracion',
                  procesado_por = 5,
                  procesado_en = NOW()
            WHERE estado = 'PENDIENTE' AND creado_en < '2026-08-01'`
        );
      }
      if (anomalousWaste.length) {
        await conn.execute(`DELETE FROM mermas WHERE id = ?`, [anomalousWaste[0].id]);
      }
      for (const item of accidentalDispatch) {
        const [stockUpdate] = await conn.execute(
          `UPDATE stock SET cantidad = cantidad + ?, actualizado_en = NOW()
            WHERE producto_id = ? AND bodega_id = ? AND lote = ?`,
          [item.cantidad_des, item.producto_id, item.bodega_id, item.lote]
        );
        if (stockUpdate.affectedRows !== 1) throw new Error(`No se pudo restaurar el stock de ${item.lote}`);
        const [lotUpdate] = await conn.execute(
          `UPDATE lots SET qty_current = qty_current + ?, status = 'DISPONIBLE'
            WHERE product_id = ? AND lpn = ?`,
          [item.cantidad_des, item.producto_id, item.lote]
        );
        if (lotUpdate.affectedRows !== 1) throw new Error(`No se pudo restaurar el lote ${item.lote}`);
      }
      if (accidentalDispatch.length) {
        const dispatch = accidentalDispatch[0];
        await conn.execute(`DELETE FROM kardex WHERE reference = ?`, [`despacho:${dispatch.numero}`]);
        await conn.execute(
          `DELETE FROM movimientos WHERE referencia_id = ? AND referencia_tipo = 'despacho_aprobado'`,
          [dispatch.id]
        );
        await conn.execute(`DELETE FROM despacho_items WHERE despacho_id = ?`, [dispatch.id]);
        await conn.execute(`DELETE FROM despachos WHERE id = ?`, [dispatch.id]);
        await conn.execute(
          `UPDATE aprobaciones
              SET estado = 'EXPIRADO', motivo_rechazo = 'Limpieza QA previa a demostracion',
                  procesado_por = 5, procesado_en = NOW()
            WHERE codigo_solicitud = 'REQ-000047' AND estado = 'APROBADO'`
        );
      }
      await conn.execute(
        `INSERT INTO system_logs (modulo, nivel, mensaje, usuario_id, payload, created_at)
         VALUES ('qa_cleanup', 'INFO', 'Limpieza conservadora de datos QA', 5, ?, NOW())`,
        [JSON.stringify({
          solicitudes_expiradas: pending.map((request) => request.codigo_solicitud),
          merma_anomala_eliminada: anomalousWaste[0]?.numero || null,
          despacho_qa_revertido: accidentalDispatch[0]?.numero || null,
        })]
      );
      await conn.commit();
    } else {
      await conn.rollback();
    }

    const [inventoryState] = await conn.execute(
      `SELECT s.cantidad, s.reservada, l.qty_current, l.status
         FROM stock s
         JOIN productos p ON p.id = s.producto_id
         LEFT JOIN lots l ON l.lpn = s.lote AND l.product_id = s.producto_id
        WHERE p.siigo_code = '00102-PTASH60' AND s.lote = 'TEST_AGENT-PTASH-DISP'`
    );
    const [remainingPending] = await conn.execute(
      `SELECT codigo_solicitud, accion, creado_en
         FROM aprobaciones WHERE estado = 'PENDIENTE'
         ORDER BY creado_en DESC`
    );

    console.log(JSON.stringify({
      mode: apply ? 'applied' : 'dry-run',
      requestStates: requests.map((request) => ({
        code: request.codigo_solicitud,
        state: request.estado,
      })),
      staleRequestsFound: pending.map((request) => request.codigo_solicitud),
      anomalousWasteFound: anomalousWaste.map((waste) => waste.numero),
      accidentalDispatchFound: accidentalDispatch.map((dispatch) => ({
        number: dispatch.numero,
        lot: dispatch.lote,
        quantity: Number(dispatch.cantidad_des),
        linkedReturns: dispatchReturns,
      })),
      inventoryState: inventoryState[0] || null,
      remainingPending,
    }, null, 2));
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`QA cleanup: ${error.message}`);
  process.exitCode = 1;
});
