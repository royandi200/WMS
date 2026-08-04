function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function resolvePrimaryWarehouse(conn) {
  const configuredId = Number(process.env.WMS_PRIMARY_WAREHOUSE_ID || process.env.DEFAULT_PRODUCTION_BODEGA_ID || 0);
  if (configuredId > 0) {
    const [byId] = await conn.execute(`SELECT id FROM bodegas WHERE id = ? AND activa = 1 LIMIT 1`, [configuredId]);
    if (byId.length) return byId[0].id;
    throw httpError(500, `La bodega principal configurada (${configuredId}) no esta activa`);
  }

  const code = String(process.env.WMS_PRIMARY_WAREHOUSE_CODE || process.env.SIIGO_WMS_WAREHOUSE_CODE || 'BG-PPAL').trim();
  const [byCode] = await conn.execute(`SELECT id FROM bodegas WHERE codigo = ? AND activa = 1 LIMIT 1`, [code]);
  if (!byCode.length) throw httpError(500, `No hay una bodega principal activa con codigo ${code}`);
  return byCode[0].id;
}

module.exports = { resolvePrimaryWarehouse };
